import { globalState } from "../globalState";
import { leetnotionClient } from "../leetnotionClient";
import { ProblemPageResponse } from "../types";
import { hasNotionIntegrationEnabled } from "../utils/settingUtils";
import { ReviewItem, ReviewSection, ReviewSectionId, ReviewStatus } from "./types";

class ReviewService {
    public isConfigured(): boolean {
        return hasNotionIntegrationEnabled()
            && Boolean(globalState.getNotionAccessToken())
            && Boolean(globalState.getQuestionsDatabaseId());
    }

    public async getSections(): Promise<ReviewSection[]> {
        return (await this.getReviewData()).sections;
    }

    public async getDueItems(): Promise<ReviewItem[]> {
        return (await this.getReviewData()).dueItems;
    }

    private async getReviewData(): Promise<{ dueItems: ReviewItem[]; sections: ReviewSection[] }> {
        const pages = await leetnotionClient.getQuestionPages();
        const dueItems: ReviewItem[] = [];
        const upcomingItems: ReviewItem[] = [];
        const today = this.formatDate(new Date());

        for (const page of pages) {
            const review = this.toReviewItem(page, today);
            if (!review) {
                continue;
            }

            if (review.status === "upcoming" || review.status === "completed") {
                upcomingItems.push(review);
            } else {
                dueItems.push(review);
            }
        }

        const sortByDate = (left: ReviewItem, right: ReviewItem) => {
            if (left.reviewDate === right.reviewDate) {
                return Number(left.questionNumber) - Number(right.questionNumber);
            }

            return left.reviewDate.localeCompare(right.reviewDate);
        };

        dueItems.sort(sortByDate);
        upcomingItems.sort(sortByDate);

        return {
            dueItems,
            sections: [
                {
                    id: ReviewSectionId.Due,
                    label: "Due",
                    emptyLabel: "No due reviews",
                    items: dueItems,
                    overdueCount: dueItems.filter(review => review.status === "overdue").length,
                },
                {
                    id: ReviewSectionId.Upcoming,
                    label: "Upcoming",
                    emptyLabel: "No upcoming reviews",
                    items: upcomingItems,
                    overdueCount: 0,
                },
            ],
        };
    }

    private toReviewItem(page: ProblemPageResponse, today: string): ReviewItem | undefined {
        const questionNumber = page.properties["Question Number"].number;
        const reviewDate = page.properties["Review Date"].date?.start;
        const url = page.properties.URL.url;
        if (questionNumber === null || !reviewDate || !url) {
            return undefined;
        }

        const reviewed = page.properties.Reviewed.checkbox;
        const status = this.getStatus(reviewDate, reviewed, today);

        return {
            pageId: page.id,
            questionNumber: questionNumber.toString(),
            name: page.properties.Name.title.map(item => item.plain_text).join("").trim(),
            difficulty: page.properties.Difficulty.select?.name ?? "",
            url,
            reviewDate,
            reviewed,
            status,
            overdueDays: status === "overdue" ? this.getDayDifference(reviewDate, today) : 0,
        };
    }

    private getStatus(reviewDate: string, reviewed: boolean, today: string): ReviewStatus {
        if (reviewDate < today) {
            return "overdue";
        }

        if (reviewDate === today) {
            return "due-today";
        }

        return reviewed ? "completed" : "upcoming";
    }

    private getDayDifference(startDate: string, endDate: string): number {
        const millisecondsPerDay = 24 * 60 * 60 * 1000;
        return Math.round((this.parseDate(endDate).getTime() - this.parseDate(startDate).getTime()) / millisecondsPerDay);
    }

    private parseDate(value: string): Date {
        const [year, month, day] = value.split("-").map(Number);
        return new Date(year, month - 1, day);
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
}

export const reviewService: ReviewService = new ReviewService();
