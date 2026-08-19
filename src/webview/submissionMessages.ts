import type { ReviewRating } from "../reviews/types";

export const SUBMISSION_NOTE_LIMIT = 20_000;
export const SUBMISSION_TAG_LIMIT = 100;
export const SUBMISSION_TAG_LENGTH_LIMIT = 100;

const FLAGS = new Set(["WHITE", "RED", "ORANGE", "YELLOW", "GREEN", "BLUE", "PURPLE"]);
const RATINGS = new Set<ReviewRating>(["again", "hard", "good", "easy"]);
const MESSAGE_KEYS = new Set(["command", "notes", "flagType", "review", "isOptimal", "tags"]);

export type ReviewEdit =
    | { kind: "unchanged" }
    | { kind: "clear" }
    | { kind: "date"; value: string }
    | { kind: "rating"; value: ReviewRating };

export interface SubmissionPropertiesMessage {
    command: "set-properties";
    notes: string;
    flagType: string;
    review: ReviewEdit;
    isOptimal: boolean;
    tags: string[];
}

export function parseSubmissionPropertiesMessage(value: unknown): SubmissionPropertiesMessage {
    const fail = (): never => {
        throw new Error("invalid-submission-properties-message");
    };
    if (!isRecord(value) || Object.keys(value).some((key) => !MESSAGE_KEYS.has(key))) {
        return fail();
    }
    if (value.command !== "set-properties"
        || typeof value.notes !== "string"
        || value.notes.length > SUBMISSION_NOTE_LIMIT
        || typeof value.flagType !== "string"
        || !FLAGS.has(value.flagType)
        || typeof value.isOptimal !== "boolean"
        || !Array.isArray(value.tags)
        || value.tags.length > SUBMISSION_TAG_LIMIT) {
        return fail();
    }

    const tags: string[] = [];
    const normalizedTags = new Set<string>();
    for (const candidate of value.tags) {
        if (typeof candidate !== "string") {
            return fail();
        }
        const tag = candidate.trim();
        const normalized = tag.toLocaleLowerCase("en-US");
        if (!tag || tag.length > SUBMISSION_TAG_LENGTH_LIMIT || normalizedTags.has(normalized)) {
            return fail();
        }
        normalizedTags.add(normalized);
        tags.push(tag);
    }

    return {
        command: "set-properties",
        notes: value.notes,
        flagType: value.flagType,
        review: parseReviewEdit(value.review, fail),
        isOptimal: value.isOptimal,
        tags,
    };
}

function parseReviewEdit(value: unknown, fail: () => never): ReviewEdit {
    if (!isRecord(value) || typeof value.kind !== "string") {
        return fail();
    }
    const keys = Object.keys(value);
    if (value.kind === "unchanged" || value.kind === "clear") {
        return keys.length === 1 ? { kind: value.kind } : fail();
    }
    if (value.kind === "date") {
        return keys.length === 2 && typeof value.value === "string" && isRealDateInput(value.value)
            ? { kind: "date", value: value.value }
            : fail();
    }
    if (value.kind === "rating") {
        return keys.length === 2 && typeof value.value === "string" && RATINGS.has(value.value as ReviewRating)
            ? { kind: "rating", value: value.value as ReviewRating }
            : fail();
    }
    return fail();
}

function isRealDateInput(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        return false;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return candidate.getUTCFullYear() === year
        && candidate.getUTCMonth() === month - 1
        && candidate.getUTCDate() === day;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
