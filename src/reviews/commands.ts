import * as vscode from "vscode";
import * as show from "../commands/show";
import { LeetCodeNode } from "../explorer/LeetCodeNode";
import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { defaultProblem, IProblem } from "../shared";
import { StudyNode } from "../study/studyNode";
import { extractArrayElements, getSheets } from "../utils/dataUtils";
import { getReviewSheetFilters, setReviewSheetFilters } from "../utils/settingUtils";
import { getQuestionNumber } from "../utils/toolUtils";
import { DialogType, promptForOpenOutputChannel } from "../utils/uiUtils";
import { getActiveFilePath, selectWorkspaceFolder } from "../utils/workspaceUtils";
import { continueStudySession, isStudySessionActive } from "../study/session";
import { studyTreeDataProvider } from "../study/studyTreeDataProvider";
import { reviewService } from "./reviewService";
import { ReviewNode } from "./reviewNode";
import { reviewTreeDataProvider } from "./reviewTreeDataProvider";
import { ReviewItem, ReviewProblemSnapshot, ReviewSchedulingOption } from "./types";

type ReviewPreset = {
    label: string;
    description: string;
    days: number;
};

type ReviewTarget = Pick<ReviewItem, "questionNumber" | "name">;

type ReviewFilterQuickPickItem = vscode.QuickPickItem & {
    value: string;
};

const reviewPresets: ReviewPreset[] = [
    { label: "Tomorrow", description: "Review again in 1 day", days: 1 },
    { label: "In 3 days", description: "Review again in 3 days", days: 3 },
    { label: "In 1 week", description: "Review again in 7 days", days: 7 },
    { label: "In 2 weeks", description: "Review again in 14 days", days: 14 },
    { label: "In 1 month", description: "Review again in 30 days", days: 30 },
];

const allProblemsFilterValue = "__all_problems__";

let reviewSessionActive = false;

export async function previewReviewProblem(review: ReviewItem | ReviewNode | StudyNode): Promise<void> {
    const reviewItem = resolveReviewItem(review);
    if (!reviewItem) {
        return;
    }

    await show.previewProblem(getProblem(reviewItem));
}

export async function openReviewProblem(review: ReviewItem | ReviewNode | StudyNode): Promise<void> {
    const reviewItem = resolveReviewItem(review);
    if (!reviewItem) {
        return;
    }

    await show.openProblem(getProblem(reviewItem));
}

export async function markReviewReviewed(review: ReviewItem | ReviewNode | StudyNode): Promise<void> {
    const reviewItem = resolveReviewItem(review);
    if (!reviewItem) {
        return;
    }

    const option = await pickReviewOption(reviewItem);
    if (!option) {
        return;
    }

    try {
        await reviewService.applyRating(reviewItem.questionNumber, option.rating);
        await reviewTreeDataProvider.refresh();
        await studyTreeDataProvider.refresh();
        if (isStudySessionActive()) {
            await continueStudySession();
        } else {
            await continueReviewSession();
        }
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to update review: ${error}`, DialogType.error);
    }
}

export async function snoozeReview(review: ReviewItem | ReviewNode | StudyNode): Promise<void> {
    const reviewItem = resolveReviewItem(review);
    if (!reviewItem) {
        return;
    }

    const preset = await pickReviewPreset(reviewItem, "Snooze");
    if (!preset) {
        return;
    }

    try {
        await reviewService.snoozeReview(reviewItem.questionNumber, addDays(new Date(), preset.days));
        await reviewTreeDataProvider.refresh();
        await studyTreeDataProvider.refresh();
        if (isStudySessionActive()) {
            await continueStudySession();
        } else {
            await continueReviewSession();
        }
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to snooze review: ${error}`, DialogType.error);
    }
}

export async function startReviewSession(): Promise<void> {
    if (!await ensureReviewWorkspaceConfigured()) {
        return;
    }

    try {
        const dueItems = await reviewService.getDueItems();
        if (dueItems.length === 0) {
            reviewSessionActive = false;
            void vscode.window.showInformationMessage("No due reviews right now.");
            return;
        }

        reviewSessionActive = true;
        await openReviewProblem(dueItems[0]);
    } catch (error) {
        reviewSessionActive = false;
        await promptForOpenOutputChannel(`Failed to start review session: ${error}`, DialogType.error);
    }
}

export async function addProblemToReview(input?: LeetCodeNode | vscode.Uri): Promise<void> {
    if (!await ensureReviewWorkspaceConfigured()) {
        return;
    }

    const questionNumber = await resolveQuestionNumber(input);
    if (!questionNumber) {
        void vscode.window.showErrorMessage("Could not determine the problem number to add to reviews.");
        return;
    }

    const problem = explorerNodeManager.getNodeById(questionNumber);
    const reviewTarget = {
        questionNumber,
        name: problem?.name ?? "Problem",
    };

    try {
        const snapshot: Partial<ReviewProblemSnapshot> = {
            name: problem?.name,
            difficulty: problem?.difficulty,
        };
        const result = await reviewService.addProblem(questionNumber, snapshot);
        await reviewTreeDataProvider.refresh();
        await studyTreeDataProvider.refresh();
        const message = result === "added"
            ? `Added [${questionNumber}] ${reviewTarget.name} to the review queue.`
            : `Moved [${questionNumber}] ${reviewTarget.name} back into the review queue.`;
        await vscode.window.showInformationMessage(message);
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to add problem to review: ${error}`, DialogType.error);
    }
}

export async function setReviewFilters(): Promise<void> {
    const sheets = getSheets();
    const activeFilters = new Set(reviewService.getActiveReviewFilters());
    const picks: ReviewFilterQuickPickItem[] = [
        {
            label: "All Problems",
            description: "Disable review filtering",
            detail: "Include every problem in the review queue",
            picked: activeFilters.size === 0,
            value: allProblemsFilterValue,
        },
        ...Object.keys(sheets).map((sheetName) => ({
            label: sheetName,
            description: `${extractArrayElements(sheets[sheetName]).length} problems`,
            detail: activeFilters.size === 0 ? undefined : activeFilters.has(sheetName) ? "Currently enabled" : undefined,
            picked: activeFilters.has(sheetName),
            value: sheetName,
        })),
    ];

    const selection = await vscode.window.showQuickPick(picks, {
        canPickMany: true,
        ignoreFocusOut: true,
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: "Select review filters. Choose All Problems to clear filtering.",
    });
    if (!selection) {
        return;
    }

    const selectedValues = selection.map((item) => item.value);
    const nextFilters = selectedValues.includes(allProblemsFilterValue)
        ? []
        : selectedValues;

    await setReviewSheetFilters(nextFilters);
    await reviewTreeDataProvider.refresh();

    const message = nextFilters.length === 0
        ? "Review filter cleared. All problems are included."
        : `Review filter updated: ${nextFilters.join(", ")}.`;
    void vscode.window.showInformationMessage(message);
}

function getProblem(review: ReviewItem): IProblem {
    const existingProblem = explorerNodeManager.getNodeById(review.questionNumber);
    if (existingProblem) {
        return existingProblem;
    }

    return {
        ...defaultProblem,
        id: review.questionNumber,
        name: review.name,
        difficulty: review.difficulty,
    };
}

function addDays(date: Date, days: number): Date {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
}

async function pickReviewPreset(review: ReviewTarget, action: string): Promise<ReviewPreset | undefined> {
    return vscode.window.showQuickPick(reviewPresets.map(preset => ({
        ...preset,
        detail: preset.description,
    })), {
        placeHolder: `${action} [${review.questionNumber}] ${review.name}`,
        ignoreFocusOut: true,
        matchOnDetail: true,
    });
}

async function pickReviewOption(review: ReviewTarget): Promise<ReviewSchedulingOption | undefined> {
    const options = await reviewService.getSchedulingOptions(review.questionNumber);
    return vscode.window.showQuickPick(options, {
        placeHolder: `Rate review [${review.questionNumber}] ${review.name}`,
        ignoreFocusOut: true,
        matchOnDescription: true,
        matchOnDetail: true,
    });
}

async function continueReviewSession(): Promise<void> {
    if (!reviewSessionActive) {
        return;
    }

    const dueItems = await reviewService.getDueItems();
    if (dueItems.length === 0) {
        reviewSessionActive = false;
        void vscode.window.showInformationMessage("Review session complete.");
        return;
    }

    await openReviewProblem(dueItems[0]);
}

async function resolveQuestionNumber(input?: LeetCodeNode | vscode.Uri): Promise<string | undefined> {
    if (input instanceof LeetCodeNode) {
        return input.id;
    }

    const filePath = await getActiveFilePath(input);
    return filePath ? getQuestionNumber(filePath) ?? undefined : undefined;
}

async function ensureReviewWorkspaceConfigured(): Promise<boolean> {
    if (reviewService.isConfigured()) {
        return true;
    }

    const workspaceFolder = await selectWorkspaceFolder();
    return workspaceFolder !== "" && reviewService.isConfigured();
}

function resolveReviewItem(input: ReviewItem | ReviewNode | StudyNode): ReviewItem | undefined {
    if ("questionNumber" in input) {
        return input;
    }

    return input.review;
}
