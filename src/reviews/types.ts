export interface ReviewItem {
    pageId: string;
    questionNumber: string;
    name: string;
    difficulty: string;
    url: string;
    reviewDate: string;
    reviewed: boolean;
    status: ReviewStatus;
    overdueDays: number;
}

export type ReviewStatus = "overdue" | "due-today" | "upcoming" | "completed";

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
