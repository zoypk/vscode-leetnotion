import { ReviewStateStorage, reviewStorage } from "./reviewStorage";
import {
    ReviewItem,
    ReviewProblemSnapshot,
    ReviewRating,
    ReviewRecord,
    ReviewSchedulingOption,
    ReviewSection,
    ReviewSectionId,
    ReviewStatus,
    SerializedFsrsCard,
} from "./types";

export type FsrsCard = {
    due: Date;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    learning_steps: number;
    reps: number;
    lapses: number;
    state: number;
    last_review?: Date;
};

interface FsrsScheduler {
    repeat(card: FsrsCard, now: Date): Record<number, { card: FsrsCard }>;
    next(card: FsrsCard, now: Date, rating: number): { card: FsrsCard };
    get_retrievability(card: FsrsCard, now: Date, decimal: boolean): number;
}

interface ReviewServiceOptions {
    storage: ReviewStateStorage;
    clock: () => Date;
    scheduler: FsrsScheduler;
    createEmptyCard: (now: Date) => FsrsCard;
    resolveProblem: (
        questionNumber: string,
        snapshot?: Partial<ReviewProblemSnapshot>,
        existing?: ReviewProblemSnapshot,
    ) => ReviewProblemSnapshot;
    activeFilters: () => string[];
}

// tslint:disable-next-line:no-eval
const fsrsPackage = eval("require")("ts-fsrs");
const defaultScheduler: FsrsScheduler = fsrsPackage.fsrs();
const ratingValues: Record<ReviewRating, number> = {
    again: fsrsPackage.Rating.Again,
    hard: fsrsPackage.Rating.Hard,
    good: fsrsPackage.Rating.Good,
    easy: fsrsPackage.Rating.Easy,
};
const reviewRatingOrder: { rating: ReviewRating; label: string }[] = [
    { rating: "again", label: "Again" },
    { rating: "hard", label: "Hard" },
    { rating: "good", label: "Good" },
    { rating: "easy", label: "Easy" },
];

export class ReviewService {
    private readonly options: ReviewServiceOptions;

    constructor(options: Partial<ReviewServiceOptions> = {}) {
        this.options = {
            storage: options.storage ?? reviewStorage,
            clock: options.clock ?? (() => new Date()),
            scheduler: options.scheduler ?? defaultScheduler,
            createEmptyCard: options.createEmptyCard ?? fsrsPackage.createEmptyCard,
            resolveProblem: options.resolveProblem ?? this.resolveProblemFromExtension.bind(this),
            activeFilters: options.activeFilters ?? this.getConfiguredFilters,
        };
    }

    public isConfigured(): boolean {
        return this.options.storage.isConfigured();
    }

    public async getSections(): Promise<ReviewSection[]> {
        return (await this.getReviewData()).sections;
    }

    public async getDueItems(): Promise<ReviewItem[]> {
        return (await this.getReviewData()).dueItems;
    }

    public getActiveReviewFilters(): string[] {
        return this.options.activeFilters();
    }

    public addProblem(
        questionNumber: string,
        snapshot?: Partial<ReviewProblemSnapshot>,
    ): Promise<"added" | "updated"> {
        const now = this.options.clock();
        return this.options.storage.transaction((state) => {
            const existing = state.reviews[questionNumber];
            if (!existing) {
                state.reviews[questionNumber] = this.createRecord(questionNumber, now, snapshot);
                return "added";
            }
            state.reviews[questionNumber] = {
                ...existing,
                problem: this.options.resolveProblem(questionNumber, snapshot, existing.problem),
                updatedAt: now.toISOString(),
            };
            return "updated";
        });
    }

    public ensureInitiallyScheduled(
        questionNumber: string,
        snapshot?: Partial<ReviewProblemSnapshot>,
        initialRating?: ReviewRating,
    ): Promise<"added" | "existing"> {
        const now = this.options.clock();
        return this.options.storage.transaction((state) => {
            const existing = state.reviews[questionNumber];
            if (existing) {
                state.reviews[questionNumber] = {
                    ...existing,
                    problem: this.options.resolveProblem(questionNumber, snapshot, existing.problem),
                    updatedAt: now.toISOString(),
                };
                return "existing";
            }

            const created = this.createRecord(questionNumber, now, snapshot);
            state.reviews[questionNumber] = initialRating
                ? this.rateRecord(created, initialRating, now)
                : created;
            return "added";
        });
    }

    public addAndApplyRating(
        questionNumber: string,
        rating: ReviewRating,
        snapshot?: Partial<ReviewProblemSnapshot>,
    ): Promise<{ result: "added" | "updated"; dueAt: string }> {
        const now = this.options.clock();
        return this.options.storage.transaction((state) => {
            const existing = state.reviews[questionNumber];
            const record = existing
                ? { ...existing, problem: this.options.resolveProblem(questionNumber, snapshot, existing.problem) }
                : this.createRecord(questionNumber, now, snapshot);
            const rated = this.rateRecord(record, rating, now);
            state.reviews[questionNumber] = rated;
            return { result: existing ? "updated" : "added", dueAt: rated.fsrsCard.due };
        });
    }

    public addAndScheduleAt(
        questionNumber: string,
        dueDate: Date,
        snapshot?: Partial<ReviewProblemSnapshot>,
    ): Promise<{ result: "added" | "updated"; dueAt: string }> {
        if (Number.isNaN(dueDate.getTime())) {
            return Promise.reject(new Error("Review due date must be valid."));
        }
        const now = this.options.clock();
        const dueAt = dueDate.toISOString();
        return this.options.storage.transaction((state) => {
            const existing = state.reviews[questionNumber];
            const record = existing
                ? { ...existing, problem: this.options.resolveProblem(questionNumber, snapshot, existing.problem) }
                : this.createRecord(questionNumber, now, snapshot);
            const card = this.deserializeCard(record.fsrsCard);
            card.due = new Date(dueAt);
            state.reviews[questionNumber] = {
                ...record,
                fsrsCard: this.serializeCard(card),
                updatedAt: now.toISOString(),
            };
            return { result: existing ? "updated" : "added", dueAt };
        });
    }

    public async getSchedulingOptions(questionNumber: string): Promise<ReviewSchedulingOption[]> {
        const record = await this.getRecord(questionNumber);
        const now = this.options.clock();
        const preview = this.options.scheduler.repeat(this.deserializeCard(record.fsrsCard), now);
        return reviewRatingOrder.map((option) => {
            const nextDue = preview[ratingValues[option.rating]].card.due;
            return {
                rating: option.rating,
                label: option.label,
                description: this.formatRelativeInterval(now, nextDue),
                detail: `Next review ${this.formatAbsoluteDue(nextDue, now)}`,
                dueAt: nextDue.toISOString(),
            };
        });
    }

    public applyRating(questionNumber: string, rating: ReviewRating): Promise<string> {
        const now = this.options.clock();
        return this.options.storage.transaction((state) => {
            const record = state.reviews[questionNumber];
            if (!record) {
                throw new Error(`Review record ${questionNumber} was not found.`);
            }
            const rated = this.rateRecord(record, rating, now);
            state.reviews[questionNumber] = rated;
            return rated.fsrsCard.due;
        });
    }

    public scheduleAt(questionNumber: string, dueDate: Date): Promise<void> {
        if (Number.isNaN(dueDate.getTime())) {
            return Promise.reject(new Error("Review due date must be valid."));
        }
        const now = this.options.clock();
        return this.options.storage.transaction((state) => {
            const record = state.reviews[questionNumber];
            if (!record) {
                throw new Error(`Review record ${questionNumber} was not found.`);
            }
            const card = this.deserializeCard(record.fsrsCard);
            card.due = dueDate;
            state.reviews[questionNumber] = {
                ...record,
                problem: this.options.resolveProblem(questionNumber, undefined, record.problem),
                fsrsCard: this.serializeCard(card),
                updatedAt: now.toISOString(),
            };
        });
    }

    public snoozeReview(questionNumber: string, dueDate: Date): Promise<void> {
        return this.scheduleAt(questionNumber, dueDate);
    }

    public removeProblem(questionNumber: string): Promise<void> {
        return this.options.storage.transaction((state) => {
            delete state.reviews[questionNumber];
        });
    }

    private createRecord(
        questionNumber: string,
        now: Date,
        snapshot?: Partial<ReviewProblemSnapshot>,
    ): ReviewRecord {
        const nowIso = now.toISOString();
        const card = this.options.createEmptyCard(now);
        card.due = now;
        return {
            questionNumber,
            problem: this.options.resolveProblem(questionNumber, snapshot),
            fsrsCard: this.serializeCard(card),
            createdAt: nowIso,
            updatedAt: nowIso,
        };
    }

    private rateRecord(record: ReviewRecord, rating: ReviewRating, now: Date): ReviewRecord {
        const result = this.options.scheduler.next(this.deserializeCard(record.fsrsCard), now, ratingValues[rating]);
        const nowIso = now.toISOString();
        return {
            ...record,
            problem: this.options.resolveProblem(record.questionNumber, undefined, record.problem),
            fsrsCard: this.serializeCard(result.card),
            updatedAt: nowIso,
            lastReviewedAt: nowIso,
            lastRating: rating,
        };
    }

    private async getReviewData(): Promise<{ dueItems: ReviewItem[]; sections: ReviewSection[] }> {
        const state = await this.options.storage.read();
        const dueItems: ReviewItem[] = [];
        const upcomingItems: ReviewItem[] = [];
        const now = this.options.clock();
        const filterSummary = this.getActiveReviewFilters();
        for (const record of Object.values(state.reviews)) {
            if (!this.matchesActiveFilters(record.questionNumber, filterSummary)) {
                continue;
            }
            const review = this.toReviewItem(record, now);
            (review.status === "upcoming" ? upcomingItems : dueItems).push(review);
        }
        const sortByDate = (left: ReviewItem, right: ReviewItem) => left.dueAt === right.dueAt
            ? Number(left.questionNumber) - Number(right.questionNumber)
            : left.dueAt.localeCompare(right.dueAt);
        dueItems.sort(sortByDate);
        upcomingItems.sort(sortByDate);
        return {
            dueItems,
            sections: [
                { id: ReviewSectionId.Due, label: "Due", emptyLabel: filterSummary.length > 0 ? "No due reviews for current filter" : "No due reviews", items: dueItems, overdueCount: dueItems.filter((review) => review.status === "overdue").length },
                { id: ReviewSectionId.Upcoming, label: "Upcoming", emptyLabel: filterSummary.length > 0 ? "No upcoming reviews for current filter" : "No upcoming reviews", items: upcomingItems, overdueCount: 0 },
            ],
        };
    }

    private async getRecord(questionNumber: string): Promise<ReviewRecord> {
        const record = (await this.options.storage.read()).reviews[questionNumber];
        if (!record) {
            throw new Error(`Review record ${questionNumber} was not found.`);
        }
        return record;
    }

    private toReviewItem(record: ReviewRecord, now: Date): ReviewItem {
        const dueDate = this.parseDate(record.fsrsCard.due);
        const status = this.getStatus(dueDate, now);
        const snapshot = this.options.resolveProblem(record.questionNumber, undefined, record.problem);
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
            retrievability: this.options.scheduler.get_retrievability(this.deserializeCard(record.fsrsCard), now, false),
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
        return reviewDate < this.startOfDay(now) ? "overdue" : "due-today";
    }

    private getDayDifference(startDate: Date, endDate: Date): number {
        return Math.round((this.startOfDay(endDate).getTime() - this.startOfDay(startDate).getTime()) / 86400000);
    }

    private startOfDay(date: Date): Date {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    private resolveProblemFromExtension(
        questionNumber: string,
        snapshot?: Partial<ReviewProblemSnapshot>,
        existingSnapshot?: ReviewProblemSnapshot,
    ): ReviewProblemSnapshot {
        const { explorerNodeManager } = require("../explorer/explorerNodeManager");
        const problem = explorerNodeManager.getNodeById(questionNumber);
        return {
            name: snapshot?.name ?? problem?.name ?? existingSnapshot?.name ?? `Problem ${questionNumber}`,
            difficulty: snapshot?.difficulty ?? problem?.difficulty ?? existingSnapshot?.difficulty ?? "",
            url: snapshot?.url ?? existingSnapshot?.url ?? this.getProblemUrl(questionNumber),
        };
    }

    private getProblemUrl(questionNumber: string): string {
        const { globalState } = require("../globalState");
        const { getUrl } = require("../shared");
        const mapping = globalState.getTitleSlugQuestionNumberMapping();
        const titleSlug = mapping && Object.keys(mapping).find((slug) => mapping[slug] === questionNumber);
        return titleSlug ? `${getUrl("base")}/problems/${titleSlug}` : "";
    }

    private serializeCard(card: FsrsCard): SerializedFsrsCard {
        return {
            due: card.due.toISOString(), stability: card.stability, difficulty: card.difficulty,
            elapsed_days: card.elapsed_days, scheduled_days: card.scheduled_days,
            learning_steps: card.learning_steps, reps: card.reps, lapses: card.lapses, state: card.state,
            last_review: card.last_review ? card.last_review.toISOString() : null,
        };
    }

    private deserializeCard(card: SerializedFsrsCard): FsrsCard {
        return {
            due: this.parseDate(card.due), stability: card.stability, difficulty: card.difficulty,
            elapsed_days: card.elapsed_days, scheduled_days: card.scheduled_days,
            learning_steps: card.learning_steps, reps: card.reps, lapses: card.lapses, state: card.state,
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

    private formatRelativeInterval(now: Date, dueDate: Date): string {
        const minutes = Math.ceil(Math.max(0, dueDate.getTime() - now.getTime()) / 60000);
        if (minutes <= 1) { return "due now"; }
        if (minutes < 60) { return `in ${minutes}m`; }
        const hours = Math.ceil(minutes / 60);
        return hours < 24 ? `in ${hours}h` : `in ${Math.ceil(hours / 24)}d`;
    }

    private formatAbsoluteDue(dueDate: Date, now: Date): string {
        const dateLabel = this.formatDate(dueDate);
        const timeLabel = dueDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return this.formatDate(now) === dateLabel ? `today at ${timeLabel}` : `${dateLabel} at ${timeLabel}`;
    }

    private matchesActiveFilters(questionNumber: string, filters: string[]): boolean {
        if (filters.length === 0) { return true; }
        const { extractArrayElements, getSheets } = require("../utils/dataUtils");
        const sheets = getSheets();
        return filters.some((filter) => sheets[filter] && extractArrayElements(sheets[filter]).includes(questionNumber));
    }

    private getConfiguredFilters(): string[] {
        const { getSheets } = require("../utils/dataUtils");
        const { getReviewSheetFilters } = require("../utils/settingUtils");
        const availableFilters = new Set(Object.keys(getSheets()));
        return getReviewSheetFilters().filter((filter) => availableFilters.has(filter));
    }

    private formatDate(date: Date): string {
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${date.getFullYear()}-${month}-${day}`;
    }
}

export const reviewService: ReviewService = new ReviewService();
