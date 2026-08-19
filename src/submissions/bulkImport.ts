import type { LeetcodeSubmission } from "../types";

export interface BulkImportCounts {
    added: number;
    existing: number;
    malformed: number;
    missingQuestion: number;
    cancelled: boolean;
}

export interface BulkImportDependencies {
    submissions: LeetcodeSubmission[];
    existingIds: Set<string>;
    malformed: number;
    resolveQuestion: (submission: LeetcodeSubmission) => { questionNumber: string; pageId: string } | undefined;
    create: (submission: LeetcodeSubmission, question: { questionNumber: string; pageId: string }) => Promise<unknown>;
    afterCreate?: (submission: LeetcodeSubmission, question: { questionNumber: string; pageId: string }, created: unknown) => Promise<void>;
    onPostCreateError?: (error: unknown, submission: LeetcodeSubmission) => void;
    onCreated?: (counts: BulkImportCounts) => void;
    isCancelled?: () => boolean;
}

export function parseSubmissionRows(value: unknown): { malformed: number; submissions: LeetcodeSubmission[] } {
    if (!Array.isArray(value)) {
        throw new Error("invalid-submissions-root");
    }
    const submissions: LeetcodeSubmission[] = [];
    let malformed = 0;
    for (const row of value) {
        if (isSubmission(row)) {
            submissions.push(row);
        } else {
            malformed += 1;
        }
    }
    return { malformed, submissions };
}

export function collectExistingSubmissionIds(pages: unknown): { ids: Set<string>; malformed: number } {
    if (!Array.isArray(pages)) {
        return { ids: new Set(), malformed: 1 };
    }
    const ids = new Set<string>();
    let malformed = 0;
    for (const page of pages) {
        const richText = getRichText(page);
        const plainText = richText?.[0]?.plain_text;
        if (typeof plainText !== "string" || !plainText.trim()) {
            malformed += 1;
            continue;
        }
        ids.add(plainText.trim());
    }
    return { ids, malformed };
}

export async function runBulkImport(dependencies: BulkImportDependencies): Promise<BulkImportCounts> {
    const counts: BulkImportCounts = {
        added: 0,
        existing: 0,
        malformed: dependencies.malformed,
        missingQuestion: 0,
        cancelled: false,
    };
    for (const submission of dependencies.submissions) {
        if (dependencies.isCancelled?.()) {
            counts.cancelled = true;
            break;
        }
        if (dependencies.existingIds.has(String(submission.id))) {
            counts.existing += 1;
            continue;
        }
        const question = dependencies.resolveQuestion(submission);
        if (!question) {
            counts.missingQuestion += 1;
            continue;
        }
        const created = await dependencies.create(submission, question);
        counts.added += 1;
        dependencies.onCreated?.({ ...counts });
        if (dependencies.afterCreate) {
            try {
                await dependencies.afterCreate(submission, question, created);
            } catch (error) {
                if (!dependencies.onPostCreateError) {
                    throw error;
                }
                dependencies.onPostCreateError(error, submission);
            }
        }
        if (dependencies.isCancelled?.()) {
            counts.cancelled = true;
            break;
        }
    }
    return counts;
}

export function formatBulkImportResult(counts: BulkImportCounts): string {
    const lead = counts.cancelled
        ? `Import cancelled after adding ${counts.added} ${plural(counts.added, "submission")}.`
        : counts.added === 0
            ? "No new submissions were added."
            : `Added ${counts.added} ${plural(counts.added, "submission")}.`;
    const details: string[] = [];
    if (counts.existing) details.push(`${counts.existing} already existed`);
    if (counts.malformed) details.push(`${counts.malformed} malformed`);
    if (counts.missingQuestion) details.push(`${counts.missingQuestion} missing questions`);
    return details.length > 0 ? `${lead} ${joinDetails(details)}.` : lead;
}

function isSubmission(value: unknown): value is LeetcodeSubmission {
    if (!isRecord(value)) return false;
    return Number.isSafeInteger(value.id)
        && typeof value.code === "string"
        && typeof value.lang === "string" && value.lang.length > 0
        && typeof value.status_display === "string"
        && typeof value.timestamp === "number" && Number.isFinite(value.timestamp)
        && typeof value.title === "string" && value.title.length > 0
        && typeof value.title_slug === "string" && value.title_slug.length > 0;
}

function getRichText(value: unknown): { plain_text?: unknown }[] | undefined {
    if (!isRecord(value) || !isRecord(value.properties)) return undefined;
    const property = value.properties["Submission ID"];
    if (!isRecord(property) || !Array.isArray(property.rich_text)) return undefined;
    return property.rich_text as { plain_text?: unknown }[];
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plural(count: number, noun: string): string {
    return count === 1 ? noun : `${noun}s`;
}

function joinDetails(details: string[]): string {
    if (details.length < 2) return details[0];
    if (details.length === 2) return `${details[0]} and ${details[1]}`;
    return `${details.slice(0, -1).join(", ")}, and ${details[details.length - 1]}`;
}
