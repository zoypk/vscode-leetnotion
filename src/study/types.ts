import { ReviewItem } from "../reviews/types";

export interface StudyProblemSnapshot {
    name: string;
    difficulty: string;
    url: string;
    tags: string[];
    sheets: string[];
}

export interface StudyBacklogRecord {
    questionNumber: string;
    problem: StudyProblemSnapshot;
    addedAt: string;
    updatedAt: string;
    deferredUntil?: string;
}

export interface StudyStateFile {
    version: number;
    backlog: Record<string, StudyBacklogRecord>;
    dailyPlans: Record<string, string[]>;
}

export function parseStudyStateFile(value: unknown, sourcePath: string = "study state"): StudyStateFile {
    const root = requireObject(value, sourcePath);
    if (root.version !== 1) {
        throw new Error(`${sourcePath}.version must be 1; received ${String(root.version)}`);
    }
    const rawBacklog = requireObject(root.backlog, `${sourcePath}.backlog`);
    const rawPlans = requireObject(root.dailyPlans, `${sourcePath}.dailyPlans`);
    const backlog: Record<string, StudyBacklogRecord> = {};
    const dailyPlans: Record<string, string[]> = {};
    for (const [key, rawRecord] of Object.entries(rawBacklog)) {
        const recordPath = `${sourcePath}.backlog.${key}`;
        const record = requireObject(rawRecord, recordPath);
        const problem = requireObject(record.problem, `${recordPath}.problem`);
        backlog[key] = {
            questionNumber: requireString(record.questionNumber, `${recordPath}.questionNumber`),
            problem: {
                name: requireString(problem.name, `${recordPath}.problem.name`),
                difficulty: requireString(problem.difficulty, `${recordPath}.problem.difficulty`),
                url: requireString(problem.url, `${recordPath}.problem.url`),
                tags: requireStringArray(problem.tags, `${recordPath}.problem.tags`),
                sheets: requireStringArray(problem.sheets, `${recordPath}.problem.sheets`),
            },
            addedAt: requireDateString(record.addedAt, `${recordPath}.addedAt`),
            updatedAt: requireDateString(record.updatedAt, `${recordPath}.updatedAt`),
            deferredUntil: optionalDayKey(record.deferredUntil, `${recordPath}.deferredUntil`),
        };
    }
    for (const [dayKey, plan] of Object.entries(rawPlans)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
            throw new Error(`${sourcePath}.dailyPlans has invalid day key ${dayKey}`);
        }
        dailyPlans[dayKey] = requireStringArray(plan, `${sourcePath}.dailyPlans.${dayKey}`);
    }
    return { version: 1, backlog, dailyPlans };
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

function requireStringArray(value: unknown, path: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`${path} must be an array of strings`);
    }
    return [...value];
}

function requireDateString(value: unknown, path: string): string {
    const dateValue = requireString(value, path);
    if (Number.isNaN(Date.parse(dateValue))) {
        throw new Error(`${path} must be a valid date string`);
    }
    return dateValue;
}

function optionalDayKey(value: unknown, path: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const dayKey = requireString(value, path);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
        throw new Error(`${path} must use YYYY-MM-DD format`);
    }
    return dayKey;
}

export interface StudyBacklogItem {
    id: string;
    questionNumber: string;
    name: string;
    difficulty: string;
    url: string;
    tags: string[];
    sheets: string[];
    addedAt: string;
    plannedForToday: boolean;
    matchesActiveFilters: boolean;
    deferredUntil?: string;
}

export interface StudyTodayReviewItem {
    kind: "review";
    id: string;
    review: ReviewItem;
}

export interface StudyTodayNewItem extends StudyBacklogItem {
    kind: "new";
}

export type StudyTodayItem = StudyTodayReviewItem | StudyTodayNewItem;

export interface StudyFilterSummary {
    sheetFilters: string[];
    topicFilters: string[];
    matchingBacklogCount: number;
    totalBacklogCount: number;
    newProblemsPerDay: number;
    weekdaysOnly: boolean;
}

export enum StudySectionId {
    Today = "today",
    Backlog = "backlog",
    Filters = "filters",
}

export interface StudySection {
    id: StudySectionId;
    label: string;
    description: string;
    emptyLabel: string;
    items: StudyTodayItem[] | StudyBacklogItem[] | string[];
}
