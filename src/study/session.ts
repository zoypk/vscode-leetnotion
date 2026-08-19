import * as vscode from "vscode";
import * as show from "../commands/show";
import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { defaultProblem, IProblem } from "../shared";
import { ReviewItem } from "../reviews/types";
import { SessionToken, sessionState } from "../sessions/sessionState";
import { StudyBacklogItem } from "./types";
import { studyService } from "./studyService";
import { selectNextStudySessionItem } from "./sessionSelection";
import { selectNextStudySessionItem } from "./sessionSelection";

export async function startStudySession(sessionToken: SessionToken): Promise<void> {
    if (!sessionState.owns(sessionToken) || sessionToken.kind !== "study") {
        return;
    }

    const nextItem = await studyService.getNextTodayItem();
    if (!sessionState.owns(sessionToken)) {
        return;
    }
    if (!nextItem) {
        await sessionState.complete(sessionToken);
        void vscode.window.showInformationMessage("No study items for today.");
        return;
    }

    try {
        if (sessionState.owns(sessionToken)) {
            await openStudyTarget(nextItem.kind === "review" ? nextItem.review : nextItem);
        }
    } catch (error) {
        await sessionState.cancel(sessionToken);
        throw error;
    }
}

export async function continueStudySession(
    sessionToken: SessionToken,
    excludedQuestionNumber?: string,
): Promise<void> {
    if (!sessionState.owns(sessionToken) || sessionToken.kind !== "study") {
        return;
    }

    const nextItem = selectNextStudySessionItem(
        await studyService.getTodayItems(),
        excludedQuestionNumber,
    );
    if (!sessionState.owns(sessionToken)) {
        return;
    }
    if (!nextItem) {
        await sessionState.complete(sessionToken);
        void vscode.window.showInformationMessage("Study session complete.");
        return;
    }

    if (sessionState.owns(sessionToken)) {
        await openStudyTarget(nextItem.kind === "review" ? nextItem.review : nextItem);
    }
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
