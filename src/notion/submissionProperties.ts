import type { UpdatePageProperties } from "@leetnotion/notion-api";
import type { ReviewEdit } from "../webview/submissionMessages";

export interface AuthoritativeSubmissionState {
    notes: string;
    flagType: string;
    isOptimal: boolean;
    tags: string[];
    reviewDate: string | null;
}

export interface ReviewSchedulePort {
    clear(questionNumber: string): Promise<void>;
    schedule(questionNumber: string, date: string): Promise<void>;
    rate(questionNumber: string, rating: "again" | "hard" | "good" | "easy"): Promise<string>;
    refresh(): Promise<void>;
}

export interface CommittedReviewEdit {
    key: string;
    reviewDate: string | null;
}

export interface NotionPropertyUpdates {
    question: UpdatePageProperties;
    submission: UpdatePageProperties;
}

export function buildLeetCodeSubmissionUpdate(state: AuthoritativeSubmissionState): { notes: string; flagType: string } {
    return { notes: state.notes, flagType: state.flagType };
}

export function buildNotionPropertyUpdates(state: AuthoritativeSubmissionState, reviewEdit: ReviewEdit): NotionPropertyUpdates {
    const question: UpdatePageProperties = {
            Tags: {
                multi_select: state.tags.map((name) => ({ name })),
            },
    };
    if (reviewEdit.kind !== "unchanged") {
        question["Review Date"] = {
            date: state.reviewDate ? { start: state.reviewDate } : null,
        };
        question["Reviewed"] = { checkbox: false };
    }
    return {
        question,
        submission: {
            Tags: {
                multi_select: state.isOptimal ? [{ name: "Optimal" }] : [],
            },
        },
    };
}

export async function applyReviewEdit(
    questionNumber: string,
    edit: ReviewEdit,
    port: ReviewSchedulePort,
    currentReviewDate: string | null = null,
): Promise<string | null> {
    if (edit.kind === "unchanged") {
        return currentReviewDate;
    }
    let reviewDate: string | null;
    if (edit.kind === "clear") {
        await port.clear(questionNumber);
        reviewDate = null;
    } else if (edit.kind === "date") {
        await port.schedule(questionNumber, edit.value);
        reviewDate = edit.value;
    } else {
        reviewDate = await port.rate(questionNumber, edit.value);
    }
    await port.refresh();
    return reviewDate;
}

export async function resolveReviewEditOnce(
    questionNumber: string,
    edit: ReviewEdit,
    port: ReviewSchedulePort,
    currentReviewDate: string | null,
    operationKey: string,
    committed: CommittedReviewEdit | undefined,
    onCommitted: (key: string, reviewDate: string | null) => void,
): Promise<string | null> {
    if (edit.kind === "unchanged") {
        return currentReviewDate;
    }
    if (committed?.key === operationKey) {
        return committed.reviewDate;
    }
    const reviewDate = await applyReviewEdit(questionNumber, edit, port, currentReviewDate);
    onCommitted(operationKey, reviewDate);
    return reviewDate;
}
