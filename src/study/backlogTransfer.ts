import { ReviewProblemSnapshot, ReviewRating } from "../reviews/types";

export interface BacklogTransferTarget {
    questionNumber: string;
    name: string;
    difficulty: string;
}

export interface BacklogTransferDependencies {
    ensureReview(
        questionNumber: string,
        snapshot: Partial<ReviewProblemSnapshot>,
        rating: ReviewRating,
    ): Promise<"added" | "existing">;
    removeBacklog(questionNumber: string): Promise<void>;
}

const MAX_DELETION_ERROR_LENGTH = 200;
const MAX_QUESTION_NUMBER_DIAGNOSTIC_LENGTH = 80;

export class BacklogTransferError extends Error {
    public readonly reviewWasScheduled = true;
    public readonly cause: unknown;

    constructor(
        public readonly questionNumber: string,
        cause: unknown,
    ) {
        const diagnosticQuestionNumber = getBoundedDiagnosticValue(
            questionNumber,
            MAX_QUESTION_NUMBER_DIAGNOSTIC_LENGTH,
            "Unknown question",
        );
        const deletionMessage = getBoundedDeletionMessage(cause);
        super(`Review ${diagnosticQuestionNumber} was scheduled, but its backlog entry could not be removed. Retry is safe. Deletion error: ${deletionMessage}`);
        this.name = "BacklogTransferError";
        Object.defineProperty(this, "cause", {
            configurable: true,
            value: cause,
            writable: true,
        });
    }
}

function getBoundedDeletionMessage(cause: unknown): string {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    return getBoundedDiagnosticValue(rawMessage, MAX_DELETION_ERROR_LENGTH, "Unknown deletion failure");
}

function getBoundedDiagnosticValue(value: string, maxLength: number, fallback: string): string {
    const normalized = value.replace(/\s+/g, " ").trim() || fallback;
    return normalized.length <= maxLength
        ? normalized
        : `${normalized.slice(0, maxLength - 3)}...`;
}

export async function transferBacklogToReview(
    target: BacklogTransferTarget,
    rating: ReviewRating,
    dependencies: BacklogTransferDependencies,
): Promise<{ review: "added" | "existing"; backlogRemoved: true }> {
    const review = await dependencies.ensureReview(target.questionNumber, {
        name: target.name,
        difficulty: target.difficulty,
    }, rating);

    try {
        await dependencies.removeBacklog(target.questionNumber);
    } catch (error) {
        throw new BacklogTransferError(target.questionNumber, error);
    }

    return { review, backlogRemoved: true };
}
