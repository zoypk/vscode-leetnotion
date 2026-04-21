import * as vscode from "vscode";
import * as show from "../commands/show";
import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { leetnotionClient } from "../leetnotionClient";
import { defaultProblem, IProblem } from "../shared";
import { DialogType, promptForOpenOutputChannel } from "../utils/uiUtils";
import { reviewTreeDataProvider } from "./reviewTreeDataProvider";
import { ReviewItem } from "./types";

type SnoozeChoice = {
    label: string;
    days: number;
};

const snoozeChoices: SnoozeChoice[] = [
    { label: "Tomorrow", days: 1 },
    { label: "In 3 days", days: 3 },
    { label: "In 1 week", days: 7 },
    { label: "In 2 weeks", days: 14 },
    { label: "In 1 month", days: 30 },
];

export async function previewReviewProblem(review: ReviewItem): Promise<void> {
    await show.previewProblem(getProblem(review));
}

export async function openReviewProblem(review: ReviewItem): Promise<void> {
    await show.openProblem(getProblem(review));
}

export async function markReviewReviewed(review: ReviewItem): Promise<void> {
    try {
        await leetnotionClient.markQuestionReviewed(review.pageId);
        await reviewTreeDataProvider.refresh();
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to mark review as completed: ${error}`, DialogType.error);
    }
}

export async function snoozeReview(review: ReviewItem): Promise<void> {
    const choice = await vscode.window.showQuickPick(snoozeChoices, {
        placeHolder: `Snooze [${review.questionNumber}] ${review.name}`,
        ignoreFocusOut: true,
    });

    if (!choice) {
        return;
    }

    try {
        await leetnotionClient.snoozeQuestionReview(review.pageId, formatDate(addDays(new Date(), choice.days)));
        await reviewTreeDataProvider.refresh();
    } catch (error) {
        await promptForOpenOutputChannel(`Failed to snooze review: ${error}`, DialogType.error);
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

function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}
