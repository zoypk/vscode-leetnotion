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

export interface NotionPropertyUpdates {
    question: UpdatePageProperties;
    submission: UpdatePageProperties;
}

export function buildLeetCodeSubmissionUpdate(state: AuthoritativeSubmissionState): { notes: string; flagType: string } {
    return { notes: state.notes, flagType: state.flagType };
}

export function buildNotionPropertyUpdates(state: AuthoritativeSubmissionState): NotionPropertyUpdates {
    return {
        question: {
            "Tags": {
                multi_select: state.tags.map((name) => ({ name })),
            },
            "Review Date": {
                date: state.reviewDate ? { start: state.reviewDate } : null,
            },
            "Reviewed": {
                checkbox: false,
            },
        },
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
