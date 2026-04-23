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
