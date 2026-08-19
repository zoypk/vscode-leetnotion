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

export class BacklogTransferError extends Error {
    public readonly reviewWasScheduled = true;

    constructor(
        public readonly questionNumber: string,
        public readonly originalError: unknown,
    ) {
        super(`Review ${questionNumber} was scheduled, but its backlog entry could not be removed. Retry is safe.`);
        this.name = "BacklogTransferError";
    }
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
