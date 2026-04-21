import { globalState } from "../globalState";
import { leetnotionClient } from "../leetnotionClient";
import { ProblemPageResponse } from "../types";
import { hasNotionIntegrationEnabled } from "../utils/settingUtils";
import { ReviewItem, ReviewSection, ReviewSectionId } from "./types";

class ReviewService {
    public isConfigured(): boolean {
        return hasNotionIntegrationEnabled()
            && Boolean(globalState.getNotionAccessToken())
            && Boolean(globalState.getQuestionsDatabaseId());
    }

    public async getSections(): Promise<ReviewSection[]> {
        const pages = await leetnotionClient.getQuestionPages();
        const dueItems: ReviewItem[] = [];
        const upcomingItems: ReviewItem[] = [];
        const today = this.formatDate(new Date());

        for (const page of pages) {
            const review = this.toReviewItem(page);
            if (!review || review.reviewed) {
                continue;
            }

            if (review.reviewDate <= today) {
                dueItems.push(review);
            } else {
                upcomingItems.push(review);
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

        return [
            {
                id: ReviewSectionId.Due,
                label: "Due",
                emptyLabel: "No due reviews",
                items: dueItems,
            },
            {
                id: ReviewSectionId.Upcoming,
                label: "Upcoming",
                emptyLabel: "No upcoming reviews",
                items: upcomingItems,
            },
        ];
    }

    private toReviewItem(page: ProblemPageResponse): ReviewItem | undefined {
        const questionNumber = page.properties["Question Number"].number;
        const reviewDate = page.properties["Review Date"].date?.start;
        const url = page.properties.URL.url;
        if (questionNumber === null || !reviewDate || !url) {
            return undefined;
        }

        return {
            pageId: page.id,
            questionNumber: questionNumber.toString(),
            name: page.properties.Name.title.map(item => item.plain_text).join("").trim(),
            difficulty: page.properties.Difficulty.select?.name ?? "",
            url,
            reviewDate,
            reviewed: page.properties.Reviewed.checkbox,
        };
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
}

export const reviewService: ReviewService = new ReviewService();
