export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface ReviewProblemSnapshot {
    name: string;
    difficulty: string;
    url: string;
}

export interface SerializedFsrsCard {
    due: string;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    learning_steps: number;
    reps: number;
    lapses: number;
    state: number;
    last_review?: string | null;
}

export interface ReviewRecord {
    questionNumber: string;
    problem: ReviewProblemSnapshot;
    fsrsCard: SerializedFsrsCard;
    createdAt: string;
    updatedAt: string;
    lastReviewedAt?: string;
    lastRating?: ReviewRating;
}

export interface ReviewStateFile {
    version: number;
    reviews: Record<string, ReviewRecord>;
}

export interface ReviewItem {
    id: string;
    questionNumber: string;
    name: string;
    difficulty: string;
    url: string;
    dueAt: string;
    reviewDate: string;
    status: ReviewStatus;
    overdueDays: number;
    scheduledDays: number;
    stability: number;
    memoryDifficulty: number;
    retrievability: number;
    reps: number;
    lapses: number;
    lastReviewedAt?: string;
    lastRating?: ReviewRating;
}

export interface ReviewSchedulingOption {
    rating: ReviewRating;
    label: string;
    description: string;
    detail: string;
    dueAt: string;
}

export type ReviewStatus = "overdue" | "due-today" | "upcoming";

export enum ReviewSectionId {
    Due = "due",
    Upcoming = "upcoming",
}

export interface ReviewSection {
    id: ReviewSectionId;
    label: string;
    emptyLabel: string;
    items: ReviewItem[];
    overdueCount: number;
}
