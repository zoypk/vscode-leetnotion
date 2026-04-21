export interface ReviewItem {
    pageId: string;
    questionNumber: string;
    name: string;
    difficulty: string;
    url: string;
    reviewDate: string;
    reviewed: boolean;
}

export enum ReviewSectionId {
    Due = "due",
    Upcoming = "upcoming",
}

export interface ReviewSection {
    id: ReviewSectionId;
    label: string;
    emptyLabel: string;
    items: ReviewItem[];
}
