import * as vscode from "vscode";
import * as show from "../commands/show";
import { LeetCodeNode } from "../explorer/LeetCodeNode";
import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { leetnotionClient } from "../leetnotionClient";
import { defaultProblem, IProblem } from "../shared";
import { getQuestionNumber } from "../utils/toolUtils";
import { DialogType, promptForOpenOutputChannel } from "../utils/uiUtils";
import { getActiveFilePath } from "../utils/workspaceUtils";
import { reviewService } from "./reviewService";
import { reviewTreeDataProvider } from "./reviewTreeDataProvider";
import { ReviewItem } from "./types";

type ReviewPreset = {
    label: string;
    description: string;
    days: number;
};

type ReviewTarget = Pick<ReviewItem, "questionNumber" | "name">;

const reviewPresets: ReviewPreset[] = [
    { label: "Tomorrow", description: "Review again in 1 day", days: 1 },
    { label: "In 3 days", description: "Review again in 3 days", days: 3 },
    { label: "In 1 week", description: "Review again in 7 days", days: 7 },
    { label: "In 2 weeks", description: "Review again in 14 days", days: 14 },
    { label: "In 1 month", description: "Review again in 30 days", days: 30 },
];

let reviewSessionActive = false;

export async function previewReviewProblem(review: ReviewItem): Promise<void> {
    await show.previewProblem(getProblem(review));
}

export async function openReviewProblem(review: ReviewItem): Promise<void> {
    await show.openProblem(getProblem(review));
}

export async function markReviewReviewed(review: ReviewItem): Promise<void> {
    const preset = await pickReviewPreset(review, "Review again");
    if (!preset) {
        return;
    }

    try {
        await leetnotionClient.markQuestionReviewed(review.pageId, formatDate(addDays(new Date(), preset.days)));
        await reviewTreeDataProvider.refresh();
        await continueReviewSession();
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to schedule next review: ${error}`, DialogType.error);
    }
}

export async function snoozeReview(review: ReviewItem): Promise<void> {
    const preset = await pickReviewPreset(review, "Snooze");
    if (!preset) {
        return;
    }

    try {
        await leetnotionClient.snoozeQuestionReview(review.pageId, formatDate(addDays(new Date(), preset.days)));
        await reviewTreeDataProvider.refresh();
        await continueReviewSession();
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to snooze review: ${error}`, DialogType.error);
    }
}

export async function startReviewSession(): Promise<void> {
    if (!reviewService.isConfigured()) {
        void vscode.window.showInformationMessage("Integrate Notion to start a review session.");
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
    if (!reviewService.isConfigured()) {
        void vscode.window.showInformationMessage("Integrate Notion to add problems to reviews.");
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

    const preset = await pickReviewPreset(reviewTarget, "Add to review");
    if (!preset) {
        return;
    }

    try {
        const reviewDate = formatDate(addDays(new Date(), preset.days));
        await leetnotionClient.scheduleQuestionReview(questionNumber, reviewDate);
        await reviewTreeDataProvider.refresh();
        await vscode.window.showInformationMessage(`Added [${questionNumber}] ${reviewTarget.name} to review for ${reviewDate}.`);
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to add problem to review: ${error}`, DialogType.error);
    }
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

function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}
