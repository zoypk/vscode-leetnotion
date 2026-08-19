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
        const questionNumber = requireString(record.questionNumber, `${recordPath}.questionNumber`);
        if (questionNumber !== key) {
            throw new Error(`${recordPath}.questionNumber must equal its review key ${key}`);
        }
        const lastRating = optionalString(record.lastRating, `${recordPath}.lastRating`);
        if (lastRating !== undefined && !["again", "hard", "good", "easy"].includes(lastRating)) {
            throw new Error(`${recordPath}.lastRating must be again, hard, good, or easy`);
        }
        const cardPath = `${recordPath}.fsrsCard`;
        const stability = requireFiniteNumber(card.stability, `${cardPath}.stability`);
        const difficulty = requireFiniteNumber(card.difficulty, `${cardPath}.difficulty`);
        const elapsedDays = requireNonnegativeInteger(card.elapsed_days, `${cardPath}.elapsed_days`);
        const scheduledDays = requireNonnegativeInteger(card.scheduled_days, `${cardPath}.scheduled_days`);
        const learningSteps = requireNonnegativeInteger(card.learning_steps, `${cardPath}.learning_steps`);
        const reps = requireNonnegativeInteger(card.reps, `${cardPath}.reps`);
        const lapses = requireNonnegativeInteger(card.lapses, `${cardPath}.lapses`);
        const state = requireFsrsState(card.state, `${cardPath}.state`);
        const lastReview = optionalNullableDateString(card.last_review, `${cardPath}.last_review`);
        validateFsrsCard(cardPath, {
            stability,
            difficulty,
            elapsedDays,
            scheduledDays,
            learningSteps,
            reps,
            lapses,
            state,
            lastReview,
        });
        reviews[key] = {
            questionNumber,
            problem: {
                name: requireString(problem.name, `${recordPath}.problem.name`),
                difficulty: requireString(problem.difficulty, `${recordPath}.problem.difficulty`),
                url: requireString(problem.url, `${recordPath}.problem.url`),
            },
            fsrsCard: {
                due: requireDateString(card.due, `${cardPath}.due`),
                stability,
                difficulty,
                elapsed_days: elapsedDays,
                scheduled_days: scheduledDays,
                learning_steps: learningSteps,
                reps,
                lapses,
                state,
                last_review: lastReview,
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

function requireNonnegativeInteger(value: unknown, path: string): number {
    const numberValue = requireFiniteNumber(value, path);
    if (!Number.isInteger(numberValue) || numberValue < 0) {
        throw new Error(`${path} must be a nonnegative integer`);
    }
    return numberValue;
}

function requireFsrsState(value: unknown, path: string): number {
    const state = requireFiniteNumber(value, path);
    if (!Number.isInteger(state) || state < 0 || state > 3) {
        throw new Error(`${path} must be an integer from 0 to 3`);
    }
    return state;
}

function validateFsrsCard(
    path: string,
    card: {
        stability: number;
        difficulty: number;
        elapsedDays: number;
        scheduledDays: number;
        learningSteps: number;
        reps: number;
        lapses: number;
        state: number;
        lastReview?: string | null;
    },
): void {
    if (card.stability < 0) {
        throw new Error(`${path}.stability must be at least 0`);
    }
    if (card.difficulty < 0 || card.difficulty > 10) {
        throw new Error(`${path}.difficulty must be between 0 and 10`);
    }
    if (card.lapses > card.reps) {
        throw new Error(`${path}.lapses must not exceed ${path}.reps`);
    }
    if (card.state === 0) {
        if (card.stability !== 0 || card.difficulty !== 0) {
            throw new Error(`${path} new FSRS card must have zero stability and difficulty`);
        }
        if (card.elapsedDays !== 0) {
            throw new Error(`${path} new FSRS card elapsed_days must be zero`);
        }
        if (card.scheduledDays !== 0) {
            throw new Error(`${path} new FSRS card scheduled_days must be zero`);
        }
        if (card.learningSteps !== 0) {
            throw new Error(`${path} new FSRS card learning_steps must be zero`);
        }
        return;
    }
    if (card.stability <= 0) {
        throw new Error(`${path} non-new FSRS card stability must be greater than 0`);
    }
    if (card.difficulty < 1 || card.difficulty > 10) {
        throw new Error(`${path} non-new FSRS card difficulty must be between 1 and 10`);
    }
    if (card.lastReview === undefined || card.lastReview === null) {
        throw new Error(`${path} non-new FSRS card must have last_review`);
    }
}

function requireDateString(value: unknown, path: string): string {
    const dateValue = requireString(value, path);
    const dateOnlyMatch = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
    const timestampMatch = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/.exec(dateValue);
    if (!dateOnlyMatch && !timestampMatch) {
        throw new Error(`${path} must be a valid ISO-8601 date`);
    }

    const match = dateOnlyMatch ?? timestampMatch as RegExpExecArray;
    if (match[1] === "-000000") {
        throw new Error(`${path} must be a valid ISO-8601 date`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidCalendarDate(year, month, day)) {
        throw new Error(`${path} must be a valid ISO-8601 date`);
    }

    if (timestampMatch) {
        const hour = Number(timestampMatch[4]);
        const minute = Number(timestampMatch[5]);
        const second = Number(timestampMatch[6]);
        const offset = timestampMatch[8];
        const offsetHour = offset === "Z" ? 0 : Number(timestampMatch[9]);
        const offsetMinute = offset === "Z" ? 0 : Number(timestampMatch[10]);
        const validTime = hour <= 23 && minute <= 59 && second <= 59;
        const validOffset = offsetHour <= 14 && offsetMinute <= 59
            && (offsetHour < 14 || offsetMinute === 0);
        if (!validTime || !validOffset) {
            throw new Error(`${path} must be a valid ISO-8601 date`);
        }
    }

    const parsed = new Date(dateOnlyMatch ? `${dateValue}T00:00:00.000Z` : dateValue);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`${path} must be a valid ISO-8601 date`);
    }
    return parsed.toISOString();
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1) {
        return false;
    }
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= daysByMonth[month - 1];
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
