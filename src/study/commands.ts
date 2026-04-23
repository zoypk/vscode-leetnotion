import * as vscode from "vscode";
import { LeetCodeNode } from "../explorer/LeetCodeNode";
import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { ReviewItem } from "../reviews/types";
import { reviewService } from "../reviews/reviewService";
import { getSheets, getTopicTags } from "../utils/dataUtils";
import {
    getStudyNewProblemsPerDay,
    setStudyNewProblemsPerDay,
    setStudySheetFilters,
    setStudyTopicFilters,
} from "../utils/settingUtils";
import { getQuestionNumber } from "../utils/toolUtils";
import { DialogType, promptForOpenOutputChannel } from "../utils/uiUtils";
import { getActiveFilePath, selectWorkspaceFolder } from "../utils/workspaceUtils";
import { studyTreeDataProvider } from "./studyTreeDataProvider";
import { StudyBacklogItem } from "./types";
import { studyService } from "./studyService";
import { continueStudySession, openStudyTarget, previewStudyTarget, startStudySession as startStudySessionRunner } from "./session";
import { reviewTreeDataProvider } from "../reviews/reviewTreeDataProvider";
import { StudyNode } from "./studyNode";

const allSheetsFilterValue = "__all_sheets__";
const allTopicsFilterValue = "__all_topics__";

export async function previewStudyProblem(target: ReviewItem | StudyBacklogItem | StudyNode): Promise<void> {
    const resolvedTarget = resolveStudyTarget(target);
    if (!resolvedTarget) {
        return;
    }

    await previewStudyTarget(resolvedTarget);
}

export async function openStudyProblem(target: ReviewItem | StudyBacklogItem | StudyNode): Promise<void> {
    const resolvedTarget = resolveStudyTarget(target);
    if (!resolvedTarget) {
        return;
    }

    await openStudyTarget(resolvedTarget);
}

export async function addProblemToBacklog(input?: LeetCodeNode | vscode.Uri): Promise<void> {
    if (!await ensureStudyWorkspaceConfigured()) {
        return;
    }

    const questionNumber = await resolveQuestionNumber(input);
    if (!questionNumber) {
        void vscode.window.showErrorMessage("Could not determine the problem number to add to backlog.");
        return;
    }

    const problem = explorerNodeManager.getNodeById(questionNumber);
    try {
        const result = await studyService.addProblem(questionNumber);
        await studyTreeDataProvider.refresh();
        const message = result === "added"
            ? `Added [${questionNumber}] ${problem?.name ?? "Problem"} to the study backlog.`
            : `Updated [${questionNumber}] ${problem?.name ?? "Problem"} in the study backlog.`;
        await vscode.window.showInformationMessage(message);
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to add problem to backlog: ${error}`, DialogType.error);
    }
}

export async function removeProblemFromBacklog(item: StudyBacklogItem | StudyNode): Promise<void> {
    const backlogItem = resolveBacklogItem(item);
    if (!backlogItem) {
        return;
    }

    try {
        await studyService.removeProblem(backlogItem.questionNumber);
        await studyTreeDataProvider.refresh();
        void vscode.window.showInformationMessage(`Removed [${backlogItem.questionNumber}] ${backlogItem.name} from backlog.`);
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to remove backlog problem: ${error}`, DialogType.error);
    }
}

export async function markStudyProblemDone(item: StudyBacklogItem | StudyNode): Promise<void> {
    const backlogItem = resolveBacklogItem(item);
    if (!backlogItem) {
        return;
    }

    const choice = await vscode.window.showQuickPick([
        {
            label: "Add to Reviews",
            description: "Move this solved problem into the FSRS review queue",
            value: "add-to-reviews",
        },
        {
            label: "Keep Solved Only",
            description: "Remove it from backlog without adding it to reviews",
            value: "complete-only",
        },
        {
            label: "Return to Backlog",
            description: "Keep it in backlog and defer it until tomorrow",
            value: "return-to-backlog",
        },
        {
            label: "Skip for Today",
            description: "Take it out of today's queue and revisit tomorrow",
            value: "skip-today",
        },
    ], {
        placeHolder: `Finish [${backlogItem.questionNumber}] ${backlogItem.name}`,
        ignoreFocusOut: true,
        matchOnDescription: true,
    });
    if (!choice) {
        return;
    }

    try {
        switch (choice.value) {
            case "add-to-reviews":
                await studyService.completeProblem(backlogItem.questionNumber);
                await reviewService.addProblem(backlogItem.questionNumber, {
                    name: backlogItem.name,
                    difficulty: backlogItem.difficulty,
                });
                await reviewTreeDataProvider.refresh();
                break;
            case "complete-only":
                await studyService.completeProblem(backlogItem.questionNumber);
                break;
            case "return-to-backlog":
            case "skip-today":
                await studyService.deferProblemUntilTomorrow(backlogItem.questionNumber);
                break;
            default:
                return;
        }

        await studyTreeDataProvider.refresh();
        await continueStudySession();
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to update study problem: ${error}`, DialogType.error);
    }
}

export async function setStudyFilters(): Promise<void> {
    try {
        const sheets = getSheets();
        const activeSheetFilters = new Set(studyService.getActiveStudySheetFilters());
        const sheetSelection = await vscode.window.showQuickPick([
            {
                label: "All Sheets",
                description: "Disable sheet filtering for new backlog selection",
                picked: activeSheetFilters.size === 0,
                value: allSheetsFilterValue,
            },
            ...Object.keys(sheets).map((sheetName) => ({
                label: sheetName,
                description: `${sheets[sheetName] ? Object.keys(sheets[sheetName]).length : 0} groups`,
                picked: activeSheetFilters.has(sheetName),
                value: sheetName,
            })),
        ], {
            canPickMany: true,
            ignoreFocusOut: true,
            matchOnDescription: true,
            placeHolder: "Select study sheet filters. Choose All Sheets to clear sheet filtering.",
        });
        if (!sheetSelection) {
            return;
        }

        const topicTags = await getTopicTags();
        const activeTopicFilters = new Set(studyService.getActiveStudyTopicFilters());
        const topicSelection = await vscode.window.showQuickPick([
            {
                label: "All Topics",
                description: "Disable topic filtering for new backlog selection",
                picked: activeTopicFilters.size === 0,
                value: allTopicsFilterValue,
            },
            ...Object.keys(topicTags)
                .sort((left, right) => left.localeCompare(right))
                .map((topic) => ({
                    label: topic,
                    description: `${topicTags[topic].length} problems`,
                    picked: activeTopicFilters.has(topic),
                    value: topic,
                })),
        ], {
            canPickMany: true,
            ignoreFocusOut: true,
            matchOnDescription: true,
            placeHolder: "Select study topic filters. Choose All Topics to clear topic filtering.",
        });
        if (!topicSelection) {
            return;
        }

        const nextSheetFilters = sheetSelection.some((item) => item.value === allSheetsFilterValue)
            ? []
            : sheetSelection.map((item) => item.value);
        const nextTopicFilters = topicSelection.some((item) => item.value === allTopicsFilterValue)
            ? []
            : topicSelection.map((item) => item.value);

        await Promise.all([
            setStudySheetFilters(nextSheetFilters),
            setStudyTopicFilters(nextTopicFilters),
        ]);
        await studyTreeDataProvider.refresh();

        const filtersSummary = [
            nextSheetFilters.length > 0 ? `Sheets: ${nextSheetFilters.join(", ")}` : "Sheets: All",
            nextTopicFilters.length > 0 ? `Topics: ${nextTopicFilters.join(", ")}` : "Topics: All",
        ].join(" | ");
        void vscode.window.showInformationMessage(`Study filters updated. ${filtersSummary}.`);
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to update study filters: ${error}`, DialogType.error);
    }
}

export async function setDailyNewProblemLimit(): Promise<void> {
    const options = Array.from({ length: 8 }, (_, index) => {
        const value = index + 1;
        return {
            label: `${value}`,
            description: value === getStudyNewProblemsPerDay() ? "Current setting" : undefined,
            value,
        };
    });
    const choice = await vscode.window.showQuickPick(options, {
        ignoreFocusOut: true,
        placeHolder: "Select how many new backlog problems to plan each day",
    });
    if (!choice) {
        return;
    }

    await setStudyNewProblemsPerDay(choice.value);
    await studyTreeDataProvider.refresh();
    void vscode.window.showInformationMessage(`Study planner will now assign ${choice.value} new problem${choice.value === 1 ? "" : "s"} per day.`);
}

export async function startStudySession(): Promise<void> {
    if (!await ensureStudyWorkspaceConfigured()) {
        return;
    }

    try {
        await startStudySessionRunner();
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to start study session: ${error}`, DialogType.error);
    }
}

async function resolveQuestionNumber(input?: LeetCodeNode | vscode.Uri): Promise<string | undefined> {
    if (input instanceof LeetCodeNode) {
        return input.id;
    }

    const filePath = await getActiveFilePath(input);
    return filePath ? getQuestionNumber(filePath) ?? undefined : undefined;
}

async function ensureStudyWorkspaceConfigured(): Promise<boolean> {
    if (studyService.isConfigured()) {
        return true;
    }

    const workspaceFolder = await selectWorkspaceFolder();
    return workspaceFolder !== "" && studyService.isConfigured();
}

function resolveStudyTarget(target: ReviewItem | StudyBacklogItem | StudyNode): ReviewItem | StudyBacklogItem | undefined {
    if (target instanceof StudyNode) {
        return target.review ?? target.backlogItem;
    }

    return target;
}

function resolveBacklogItem(target: StudyBacklogItem | StudyNode): StudyBacklogItem | undefined {
    const resolvedTarget = resolveStudyTarget(target);
    if (!resolvedTarget || !("plannedForToday" in resolvedTarget)) {
        return undefined;
    }

    return resolvedTarget;
}
