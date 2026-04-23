import * as vscode from "vscode";
import * as show from "../commands/show";
import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { defaultProblem, IProblem } from "../shared";
import { ReviewItem } from "../reviews/types";
import { StudyBacklogItem } from "./types";
import { studyService } from "./studyService";

let studySessionActive = false;

export function isStudySessionActive(): boolean {
    return studySessionActive;
}

export function stopStudySession(): void {
    studySessionActive = false;
}

export async function startStudySession(): Promise<void> {
    const nextItem = await studyService.getNextTodayItem();
    if (!nextItem) {
        studySessionActive = false;
        void vscode.window.showInformationMessage("No study items for today.");
        return;
    }

    studySessionActive = true;
    await openStudyTarget(nextItem.kind === "review" ? nextItem.review : nextItem);
}

export async function continueStudySession(): Promise<void> {
    if (!studySessionActive) {
        return;
    }

    const nextItem = await studyService.getNextTodayItem();
    if (!nextItem) {
        studySessionActive = false;
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
