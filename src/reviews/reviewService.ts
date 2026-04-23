import { Card, createEmptyCard, fsrs, Rating } from "ts-fsrs";
import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { globalState } from "../globalState";
import { getUrl } from "../shared";
import { getReviewSheetFilters } from "../utils/settingUtils";
import { extractArrayElements, getSheets } from "../utils/dataUtils";
import {
    ReviewItem,
    ReviewProblemSnapshot,
    ReviewRating,
    ReviewRecord,
    ReviewSchedulingOption,
    ReviewSection,
    ReviewSectionId,
    ReviewStateFile,
    ReviewStatus,
    SerializedFsrsCard,
} from "./types";
import { reviewStorage } from "./reviewStorage";

const scheduler = fsrs();

const reviewRatingOrder: Array<{ rating: ReviewRating; label: string; fsrsRating: Rating }> = [
    { rating: "again", label: "Again", fsrsRating: Rating.Again },
    { rating: "hard", label: "Hard", fsrsRating: Rating.Hard },
    { rating: "good", label: "Good", fsrsRating: Rating.Good },
    { rating: "easy", label: "Easy", fsrsRating: Rating.Easy },
];

class ReviewService {
    public isConfigured(): boolean {
        return reviewStorage.isConfigured();
    }

    public async getSections(): Promise<ReviewSection[]> {
        return (await this.getReviewData()).sections;
    }

    public async getDueItems(): Promise<ReviewItem[]> {
        return (await this.getReviewData()).dueItems;
    }

    public getActiveReviewFilters(): string[] {
        const sheets = getSheets();
        const availableFilters = new Set(Object.keys(sheets));
        return getReviewSheetFilters().filter((filter) => availableFilters.has(filter));
    }

    public async addProblem(questionNumber: string, snapshot?: Partial<ReviewProblemSnapshot>): Promise<"added" | "updated"> {
        const state = await reviewStorage.load();
        const existingRecord = state.reviews[questionNumber];
        const now = new Date();
        const nowIso = now.toISOString();
        const card = existingRecord ? this.deserializeCard(existingRecord.fsrsCard) : createEmptyCard(now);

        card.due = now;

        state.reviews[questionNumber] = {
            questionNumber,
            problem: this.resolveProblemSnapshot(questionNumber, snapshot, existingRecord?.problem),
            fsrsCard: this.serializeCard(card),
            createdAt: existingRecord?.createdAt ?? nowIso,
            updatedAt: nowIso,
            lastReviewedAt: existingRecord?.lastReviewedAt,
            lastRating: existingRecord?.lastRating,
        };

        await reviewStorage.save(state);
        return existingRecord ? "updated" : "added";
    }

    public async getSchedulingOptions(questionNumber: string): Promise<ReviewSchedulingOption[]> {
        const record = await this.getRecord(questionNumber);
        const now = new Date();
        const preview = scheduler.repeat(this.deserializeCard(record.fsrsCard), now);

        return reviewRatingOrder.map(option => {
            const nextDue = preview[option.fsrsRating].card.due;

            return {
                rating: option.rating,
                label: option.label,
                description: this.formatRelativeInterval(now, nextDue),
                detail: `Next review ${this.formatAbsoluteDue(nextDue, now)}`,
                dueAt: nextDue.toISOString(),
            };
        });
    }

    public async applyRating(questionNumber: string, rating: ReviewRating): Promise<string> {
        const state = await reviewStorage.load();
        const record = state.reviews[questionNumber];
        if (!record) {
            throw new Error(`Review record ${questionNumber} was not found.`);
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const result = scheduler.next(this.deserializeCard(record.fsrsCard), now, this.toFsrsRating(rating));

        state.reviews[questionNumber] = {
            ...record,
            problem: this.resolveProblemSnapshot(questionNumber, undefined, record.problem),
            fsrsCard: this.serializeCard(result.card),
            updatedAt: nowIso,
            lastReviewedAt: nowIso,
            lastRating: rating,
        };

        await reviewStorage.save(state);
        return result.card.due.toISOString();
    }

    public async snoozeReview(questionNumber: string, dueDate: Date): Promise<void> {
        const state = await reviewStorage.load();
        const record = state.reviews[questionNumber];
        if (!record) {
            throw new Error(`Review record ${questionNumber} was not found.`);
        }

        const card = this.deserializeCard(record.fsrsCard);
        card.due = dueDate;

        state.reviews[questionNumber] = {
            ...record,
            problem: this.resolveProblemSnapshot(questionNumber, undefined, record.problem),
            fsrsCard: this.serializeCard(card),
            updatedAt: new Date().toISOString(),
        };

        await reviewStorage.save(state);
    }

    private async getReviewData(): Promise<{ dueItems: ReviewItem[]; sections: ReviewSection[] }> {
        const state = await reviewStorage.load();
        const dueItems: ReviewItem[] = [];
        const upcomingItems: ReviewItem[] = [];
        const now = new Date();
        const filterSummary = this.getActiveReviewFilters();

        for (const record of Object.values(state.reviews)) {
            if (!this.matchesActiveFilters(record.questionNumber, filterSummary)) {
                continue;
            }

            const review = this.toReviewItem(record, now);

            if (review.status === "upcoming") {
                upcomingItems.push(review);
            } else {
                dueItems.push(review);
            }
        }

        const sortByDate = (left: ReviewItem, right: ReviewItem) => {
            if (left.dueAt === right.dueAt) {
                return Number(left.questionNumber) - Number(right.questionNumber);
            }

            return left.dueAt.localeCompare(right.dueAt);
        };

        dueItems.sort(sortByDate);
        upcomingItems.sort(sortByDate);

        return {
            dueItems,
            sections: [
                {
                    id: ReviewSectionId.Due,
                    label: "Due",
                    emptyLabel: filterSummary.length > 0 ? "No due reviews for current filter" : "No due reviews",
                    items: dueItems,
                    overdueCount: dueItems.filter(review => review.status === "overdue").length,
                },
                {
                    id: ReviewSectionId.Upcoming,
                    label: "Upcoming",
                    emptyLabel: filterSummary.length > 0 ? "No upcoming reviews for current filter" : "No upcoming reviews",
                    items: upcomingItems,
                    overdueCount: 0,
                },
            ],
        };
    }

    private async getRecord(questionNumber: string): Promise<ReviewRecord> {
        const state = await reviewStorage.load();
        const record = state.reviews[questionNumber];
        if (!record) {
            throw new Error(`Review record ${questionNumber} was not found.`);
        }

        return record;
    }

    private toReviewItem(record: ReviewRecord, now: Date): ReviewItem {
        const dueDate = this.parseDate(record.fsrsCard.due);
        const status = this.getStatus(dueDate, now);
        const snapshot = this.resolveProblemSnapshot(record.questionNumber, undefined, record.problem);

        return {
            id: record.questionNumber,
            questionNumber: record.questionNumber,
            name: snapshot.name,
            difficulty: snapshot.difficulty,
            url: snapshot.url,
            dueAt: dueDate.toISOString(),
            reviewDate: this.formatDate(dueDate),
            status,
            overdueDays: status === "overdue" ? this.getDayDifference(dueDate, now) : 0,
            scheduledDays: record.fsrsCard.scheduled_days,
            stability: record.fsrsCard.stability,
            memoryDifficulty: record.fsrsCard.difficulty,
            retrievability: this.getRetrievability(record.fsrsCard, now),
            reps: record.fsrsCard.reps,
            lapses: record.fsrsCard.lapses,
            lastReviewedAt: record.lastReviewedAt,
            lastRating: record.lastRating,
        };
    }

    private getStatus(reviewDate: Date, now: Date): ReviewStatus {
        if (reviewDate.getTime() > now.getTime()) {
            return "upcoming";
        }

        if (reviewDate < this.startOfDay(now)) {
            return "overdue";
        }

        return "due-today";
    }

    private getDayDifference(startDate: Date, endDate: Date): number {
        const millisecondsPerDay = 24 * 60 * 60 * 1000;
        return Math.round((this.startOfDay(endDate).getTime() - this.startOfDay(startDate).getTime()) / millisecondsPerDay);
    }

    private startOfDay(date: Date): Date {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    private resolveProblemSnapshot(
        questionNumber: string,
        snapshot?: Partial<ReviewProblemSnapshot>,
        existingSnapshot?: ReviewProblemSnapshot,
    ): ReviewProblemSnapshot {
        const problem = explorerNodeManager.getNodeById(questionNumber);
        return {
            name: snapshot?.name ?? problem?.name ?? existingSnapshot?.name ?? `Problem ${questionNumber}`,
            difficulty: snapshot?.difficulty ?? problem?.difficulty ?? existingSnapshot?.difficulty ?? "",
            url: snapshot?.url ?? existingSnapshot?.url ?? this.getProblemUrl(questionNumber),
        };
    }

    private getProblemUrl(questionNumber: string): string {
        const mapping = globalState.getTitleSlugQuestionNumberMapping();
        if (!mapping) {
            return "";
        }

        const titleSlug = Object.keys(mapping).find((slug) => mapping[slug] === questionNumber);
        return titleSlug ? `${getUrl("base")}/problems/${titleSlug}` : "";
    }

    private serializeCard(card: Card): SerializedFsrsCard {
        return {
            due: card.due.toISOString(),
            stability: card.stability,
            difficulty: card.difficulty,
            elapsed_days: card.elapsed_days,
            scheduled_days: card.scheduled_days,
            learning_steps: card.learning_steps,
            reps: card.reps,
            lapses: card.lapses,
            state: card.state,
            last_review: card.last_review ? card.last_review.toISOString() : null,
        };
    }

    private deserializeCard(card: SerializedFsrsCard): Card {
        return {
            due: this.parseDate(card.due),
            stability: card.stability,
            difficulty: card.difficulty,
            elapsed_days: card.elapsed_days,
            scheduled_days: card.scheduled_days,
            learning_steps: card.learning_steps,
            reps: card.reps,
            lapses: card.lapses,
            state: card.state,
            last_review: card.last_review ? this.parseDate(card.last_review) : undefined,
        };
    }

    private parseDate(value: string): Date {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            throw new Error(`Invalid review date: ${value}`);
        }

        return parsed;
    }

    private toFsrsRating(rating: ReviewRating): Rating {
        return reviewRatingOrder.find((option) => option.rating === rating)?.fsrsRating ?? Rating.Good;
    }

    private formatRelativeInterval(now: Date, dueDate: Date): string {
        const diffMs = Math.max(0, dueDate.getTime() - now.getTime());
        const diffMinutes = Math.ceil(diffMs / (60 * 1000));
        if (diffMinutes <= 1) {
            return "due now";
        }

        if (diffMinutes < 60) {
            return `in ${diffMinutes}m`;
        }

        const diffHours = Math.ceil(diffMinutes / 60);
        if (diffHours < 24) {
            return `in ${diffHours}h`;
        }

        return `in ${Math.ceil(diffHours / 24)}d`;
    }

    private formatAbsoluteDue(dueDate: Date, now: Date): string {
        const dateLabel = this.formatDate(dueDate);
        const timeLabel = dueDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

        if (this.formatDate(now) === dateLabel) {
            return `today at ${timeLabel}`;
        }

        return `${dateLabel} at ${timeLabel}`;
    }

    private getRetrievability(card: SerializedFsrsCard, now: Date): number {
        return scheduler.get_retrievability(this.deserializeCard(card), now, false);
    }

    private matchesActiveFilters(questionNumber: string, filters: string[]): boolean {
        if (filters.length === 0) {
            return true;
        }

        const sheets = getSheets();
        return filters.some((filter) => {
            const sheet = sheets[filter];
            return sheet ? extractArrayElements(sheet).includes(questionNumber) : false;
        });
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
}

export const reviewService: ReviewService = new ReviewService();
