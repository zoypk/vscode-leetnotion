import * as vscode from "vscode";
import * as show from "../commands/show";
import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { defaultProblem, IProblem } from "../shared";
import { ReviewItem } from "../reviews/types";
import { sessionState } from "../sessions/sessionState";
import { StudyBacklogItem } from "./types";
import { studyService } from "./studyService";

export async function startStudySession(): Promise<void> {
    const nextItem = await studyService.getNextTodayItem();
    if (!nextItem) {
        await sessionState.complete("study");
        void vscode.window.showInformationMessage("No study items for today.");
        return;
    }

    await sessionState.start("study");
    try {
        await openStudyTarget(nextItem.kind === "review" ? nextItem.review : nextItem);
    } catch (error) {
        await sessionState.cancel("study");
        throw error;
    }
}

export async function continueStudySession(): Promise<void> {
    if (!sessionState.isActive("study")) {
        return;
    }

    const nextItem = await studyService.getNextTodayItem();
    if (!sessionState.isActive("study")) {
        return;
    }
    if (!nextItem) {
        await sessionState.complete("study");
        void vscode.window.showInformationMessage("Study session complete.");
        return;
    }

    await openStudyTarget(nextItem.kind === "review" ? nextItem.review : nextItem);
}

export async function openStudyTarget(target: ReviewItem | StudyBacklogItem): Promise<void> {
    await show.openProblem(getProblem(target));
}

export async function previewStudyTarget(target: ReviewItem | StudyBacklogItem): Promise<void> {
    await show.previewProblem(getProblem(target));
}

function getProblem(target: ReviewItem | StudyBacklogItem): IProblem {
    const existingProblem = explorerNodeManager.getNodeById(target.questionNumber);
    if (existingProblem) {
        return existingProblem;
    }

    const tags = "tags" in target ? target.tags : [];
    return {
        ...defaultProblem,
        id: target.questionNumber,
        name: target.name,
        difficulty: target.difficulty,
        tags,
    };
}
