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

export function parseReviewStateFile(value: unknown, sourcePath: string = "review state"): ReviewStateFile {
    const root = requireObject(value, sourcePath);
    if (root.version !== 1) {
        throw new Error(`${sourcePath}.version must be 1; received ${String(root.version)}`);
    }
    const rawReviews = requireObject(root.reviews, `${sourcePath}.reviews`);
    const reviews: Record<string, ReviewRecord> = {};
    for (const [key, rawRecord] of Object.entries(rawReviews)) {
        const recordPath = `${sourcePath}.reviews.${key}`;
        const record = requireObject(rawRecord, recordPath);
        const problem = requireObject(record.problem, `${recordPath}.problem`);
        const card = requireObject(record.fsrsCard, `${recordPath}.fsrsCard`);
        const lastRating = optionalString(record.lastRating, `${recordPath}.lastRating`);
        if (lastRating !== undefined && !["again", "hard", "good", "easy"].includes(lastRating)) {
            throw new Error(`${recordPath}.lastRating must be again, hard, good, or easy`);
        }
        reviews[key] = {
            questionNumber: requireString(record.questionNumber, `${recordPath}.questionNumber`),
            problem: {
                name: requireString(problem.name, `${recordPath}.problem.name`),
                difficulty: requireString(problem.difficulty, `${recordPath}.problem.difficulty`),
                url: requireString(problem.url, `${recordPath}.problem.url`),
            },
            fsrsCard: {
                due: requireDateString(card.due, `${recordPath}.fsrsCard.due`),
                stability: requireFiniteNumber(card.stability, `${recordPath}.fsrsCard.stability`),
                difficulty: requireFiniteNumber(card.difficulty, `${recordPath}.fsrsCard.difficulty`),
                elapsed_days: requireFiniteNumber(card.elapsed_days, `${recordPath}.fsrsCard.elapsed_days`),
                scheduled_days: requireFiniteNumber(card.scheduled_days, `${recordPath}.fsrsCard.scheduled_days`),
                learning_steps: requireFiniteNumber(card.learning_steps, `${recordPath}.fsrsCard.learning_steps`),
                reps: requireFiniteNumber(card.reps, `${recordPath}.fsrsCard.reps`),
                lapses: requireFiniteNumber(card.lapses, `${recordPath}.fsrsCard.lapses`),
                state: requireFiniteNumber(card.state, `${recordPath}.fsrsCard.state`),
                last_review: optionalNullableDateString(card.last_review, `${recordPath}.fsrsCard.last_review`),
            },
            createdAt: requireDateString(record.createdAt, `${recordPath}.createdAt`),
            updatedAt: requireDateString(record.updatedAt, `${recordPath}.updatedAt`),
            lastReviewedAt: optionalDateString(record.lastReviewedAt, `${recordPath}.lastReviewedAt`),
            lastRating: lastRating as ReviewRating | undefined,
        };
    }
    return { version: 1, reviews };
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
    if (typeof value !== "string") {
        throw new Error(`${path} must be a string`);
    }
    return value;
}

function optionalString(value: unknown, path: string): string | undefined {
    return value === undefined ? undefined : requireString(value, path);
}

function requireFiniteNumber(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${path} must be a finite number`);
    }
    return value;
}

function requireDateString(value: unknown, path: string): string {
    const dateValue = requireString(value, path);
    if (Number.isNaN(Date.parse(dateValue))) {
        throw new Error(`${path} must be a valid date string`);
    }
    return dateValue;
}

function optionalDateString(value: unknown, path: string): string | undefined {
    return value === undefined ? undefined : requireDateString(value, path);
}

function optionalNullableDateString(value: unknown, path: string): string | null | undefined {
    return value === null ? null : optionalDateString(value, path);
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
