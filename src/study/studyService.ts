import { ReviewItem } from "../reviews/types";
import { StudyStateStorage, studyStorage } from "./studyStorage";
import {
    StudyBacklogItem,
    StudyBacklogRecord,
    StudyFilterSummary,
    StudyProblemSnapshot,
    StudySection,
    StudySectionId,
    StudyStateFile,
    StudyTodayItem,
} from "./types";

interface StudyServiceOptions {
    storage: StudyStateStorage;
    clock: () => Date;
    getDueReviews: () => Promise<ReviewItem[]>;
    activeSheetFilters: () => string[];
    activeTopicFilters: () => string[];
    newProblemsPerDay: () => number;
    weekdaysOnly: () => boolean;
    resolveProblem: (questionNumber: string, existing?: StudyProblemSnapshot) => StudyProblemSnapshot;
}

interface StudySettingsSnapshot {
    sheetFilters: string[];
    topicFilters: string[];
    newProblemsPerDay: number;
    weekdaysOnly: boolean;
}

export function normalizeStudyNewProblemLimit(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export class StudyService {
    private readonly options: StudyServiceOptions;

    constructor(options: Partial<StudyServiceOptions> = {}) {
        this.options = {
            storage: options.storage ?? studyStorage,
            clock: options.clock ?? (() => new Date()),
            getDueReviews: options.getDueReviews ?? (() => require("../reviews/reviewService").reviewService.getDueItems()),
            activeSheetFilters: options.activeSheetFilters ?? this.getConfiguredSheetFilters,
            activeTopicFilters: options.activeTopicFilters ?? this.getConfiguredTopicFilters,
            newProblemsPerDay: options.newProblemsPerDay ?? (() => require("../utils/settingUtils").getStudyNewProblemsPerDay()),
            weekdaysOnly: options.weekdaysOnly ?? (() => require("../utils/settingUtils").shouldUseStudyWeekdaysOnly()),
            resolveProblem: options.resolveProblem ?? this.resolveProblemFromExtension.bind(this),
        };
    }

    public isConfigured(): boolean {
        return this.options.storage.isConfigured();
    }

    public getSections(): Promise<StudySection[]> {
        return this.refresh();
    }

    public async refresh(): Promise<StudySection[]> {
        const now = this.options.clock();
        const settings = this.getSettingsSnapshot(now);
        const state = await this.options.storage.transaction((draft) => {
            this.materializeDailyPlan(draft, now, settings);
            return draft;
        });
        const reviewItems = await this.options.getDueReviews();
        return this.buildSections(state, reviewItems, now, settings);
    }

    public async getTodayItems(): Promise<StudyTodayItem[]> {
        const now = this.options.clock();
        const [reviewItems, state] = await Promise.all([this.options.getDueReviews(), this.options.storage.read()]);
        return this.buildTodayItems(state, reviewItems, now, this.getSettingsSnapshot(now));
    }

    public async getNextTodayItem(): Promise<StudyTodayItem | undefined> {
        return (await this.getTodayItems())[0];
    }

    public async getBacklogItems(): Promise<StudyBacklogItem[]> {
        const now = this.options.clock();
        const state = await this.options.storage.read();
        return this.buildBacklogItems(state, now, this.getSettingsSnapshot(now));
    }

    public async getFilterSummary(): Promise<StudyFilterSummary> {
        const now = this.options.clock();
        const state = await this.options.storage.read();
        return this.buildFilterSummary(state, now, this.getSettingsSnapshot(now));
    }

    public addProblem(questionNumber: string): Promise<"added" | "updated"> {
        const now = this.options.clock();
        return this.options.storage.transaction((state) => {
            const existing = state.backlog[questionNumber];
            const nowIso = now.toISOString();
            state.backlog[questionNumber] = {
                questionNumber,
                problem: this.options.resolveProblem(questionNumber, existing?.problem),
                addedAt: existing?.addedAt ?? nowIso,
                updatedAt: nowIso,
                deferredUntil: undefined,
            };
            return existing ? "updated" : "added";
        });
    }

    public removeProblem(questionNumber: string): Promise<void> {
        return this.options.storage.transaction((state) => {
            delete state.backlog[questionNumber];
            this.removeFromAllDailyPlans(state, questionNumber);
        });
    }

    public completeProblem(questionNumber: string): Promise<void> {
        return this.removeProblem(questionNumber);
    }

    public deferProblemUntilTomorrow(questionNumber: string): Promise<void> {
        const now = this.options.clock();
        return this.options.storage.transaction((state) => {
            const record = state.backlog[questionNumber];
            if (!record) {
                throw new Error(`Study backlog record ${questionNumber} was not found.`);
            }
            state.backlog[questionNumber] = {
                ...record,
                problem: this.options.resolveProblem(questionNumber, record.problem),
                updatedAt: now.toISOString(),
                deferredUntil: this.getDayKey(this.addDays(now, 1)),
            };
            this.removeFromDailyPlan(state, this.getDayKey(now), questionNumber);
        });
    }

    public clearDailyPlan(questionNumber: string): Promise<void> {
        const dayKey = this.getDayKey(this.options.clock());
        return this.options.storage.transaction((state) => this.removeFromDailyPlan(state, dayKey, questionNumber));
    }

    public getActiveStudySheetFilters(): string[] {
        return this.options.activeSheetFilters();
    }

    public getActiveStudyTopicFilters(): string[] {
        return this.options.activeTopicFilters();
    }

    private materializeDailyPlan(state: StudyStateFile, date: Date, settings: StudySettingsSnapshot): void {
        const dayKey = this.getDayKey(date);
        const currentPlan = (state.dailyPlans[dayKey] ?? []).filter((questionNumber) => {
            const record = state.backlog[questionNumber];
            return Boolean(record) && !this.isDeferred(record, dayKey) && this.matchesActiveFilters(record, settings);
        });
        const nextPlan = currentPlan.slice(0, settings.newProblemsPerDay);
        for (const record of this.getEligibleBacklogRecords(state, dayKey, settings)) {
            if (nextPlan.length >= settings.newProblemsPerDay) { break; }
            if (!nextPlan.includes(record.questionNumber)) { nextPlan.push(record.questionNumber); }
        }
        if (nextPlan.length === 0) {
            delete state.dailyPlans[dayKey];
        } else {
            state.dailyPlans[dayKey] = nextPlan;
        }
    }

    private buildSections(
        state: StudyStateFile,
        reviewItems: ReviewItem[],
        now: Date,
        settings: StudySettingsSnapshot,
    ): StudySection[] {
        const todayItems = this.buildTodayItems(state, reviewItems, now, settings);
        const backlogItems = this.buildBacklogItems(state, now, settings);
        const filterSummary = this.buildFilterSummary(state, now, settings, backlogItems);
        return [
            { id: StudySectionId.Today, label: "Today", description: `${todayItems.length}`, emptyLabel: this.getTodayEmptyLabel(filterSummary), items: todayItems },
            { id: StudySectionId.Backlog, label: "Backlog", description: `${backlogItems.length}`, emptyLabel: "No backlog problems yet", items: backlogItems },
            { id: StudySectionId.Filters, label: "Filters", description: this.getFilterSectionDescription(filterSummary), emptyLabel: "No study filters configured", items: this.getFilterMessages(filterSummary) },
        ];
    }

    private buildTodayItems(
        state: StudyStateFile,
        reviewItems: ReviewItem[],
        now: Date,
        settings: StudySettingsSnapshot,
    ): StudyTodayItem[] {
        const plan = (state.dailyPlans[this.getDayKey(now)] ?? []).filter((questionNumber) => {
            const record = state.backlog[questionNumber];
            return Boolean(record) && !this.isDeferred(record, this.getDayKey(now)) && this.matchesActiveFilters(record, settings);
        });
        const planSet = new Set(plan);
        return [
            ...reviewItems.map((review) => ({ kind: "review" as const, id: `study-review-${review.questionNumber}`, review })),
            ...plan.map((questionNumber) => state.backlog[questionNumber])
                .filter((record): record is StudyBacklogRecord => Boolean(record))
                .map((record) => ({ kind: "new" as const, ...this.toBacklogItem(record, planSet, settings) })),
        ];
    }

    private buildBacklogItems(state: StudyStateFile, now: Date, settings: StudySettingsSnapshot): StudyBacklogItem[] {
        const todayPlan = new Set(state.dailyPlans[this.getDayKey(now)] ?? []);
        return Object.values(state.backlog)
            .sort((left, right) => left.addedAt.localeCompare(right.addedAt) || Number(left.questionNumber) - Number(right.questionNumber))
            .map((record) => this.toBacklogItem(record, todayPlan, settings));
    }

    private buildFilterSummary(
        state: StudyStateFile,
        now: Date,
        settings: StudySettingsSnapshot,
        backlogItems: StudyBacklogItem[] = this.buildBacklogItems(state, now, settings),
    ): StudyFilterSummary {
        return {
            sheetFilters: settings.sheetFilters,
            topicFilters: settings.topicFilters,
            matchingBacklogCount: backlogItems.filter((item) => item.matchesActiveFilters).length,
            totalBacklogCount: backlogItems.length,
            newProblemsPerDay: settings.newProblemsPerDay,
            weekdaysOnly: settings.weekdaysOnly,
        };
    }

    private getSettingsSnapshot(date: Date): StudySettingsSnapshot {
        const weekdaysOnly = this.options.weekdaysOnly();
        return {
            sheetFilters: [...this.options.activeSheetFilters()],
            topicFilters: [...this.options.activeTopicFilters()],
            newProblemsPerDay: weekdaysOnly && this.isWeekend(date)
                ? 0
                : normalizeStudyNewProblemLimit(this.options.newProblemsPerDay()),
            weekdaysOnly,
        };
    }

    private getEligibleBacklogRecords(
        state: StudyStateFile,
        dayKey: string,
        settings: StudySettingsSnapshot,
    ): StudyBacklogRecord[] {
        return Object.values(state.backlog)
            .filter((record) => !this.isDeferred(record, dayKey) && this.matchesActiveFilters(record, settings))
            .sort((left, right) => left.addedAt.localeCompare(right.addedAt) || Number(left.questionNumber) - Number(right.questionNumber));
    }

    private matchesActiveFilters(record: StudyBacklogRecord, settings: StudySettingsSnapshot): boolean {
        const matchesSheets = settings.sheetFilters.length === 0 || settings.sheetFilters.some((filter) => record.problem.sheets.includes(filter));
        const matchesTopics = settings.topicFilters.length === 0 || settings.topicFilters.some((filter) => record.problem.tags.includes(filter));
        return matchesSheets && matchesTopics;
    }

    private toBacklogItem(
        record: StudyBacklogRecord,
        todayPlan: Set<string>,
        settings: StudySettingsSnapshot,
    ): StudyBacklogItem {
        return {
            id: `study-backlog-${record.questionNumber}`,
            questionNumber: record.questionNumber,
            name: record.problem.name,
            difficulty: record.problem.difficulty,
            url: record.problem.url,
            tags: record.problem.tags,
            sheets: record.problem.sheets,
            addedAt: record.addedAt,
            plannedForToday: todayPlan.has(record.questionNumber),
            matchesActiveFilters: this.matchesActiveFilters(record, settings),
            deferredUntil: record.deferredUntil,
        };
    }

    private resolveProblemFromExtension(questionNumber: string, existing?: StudyProblemSnapshot): StudyProblemSnapshot {
        const { explorerNodeManager } = require("../explorer/explorerNodeManager");
        const problem = explorerNodeManager.getNodeById(questionNumber);
        return {
            name: problem?.name ?? existing?.name ?? `Problem ${questionNumber}`,
            difficulty: problem?.difficulty ?? existing?.difficulty ?? "",
            url: existing?.url ?? this.getProblemUrl(questionNumber),
            tags: problem?.tags ?? existing?.tags ?? [],
            sheets: this.getProblemSheets(questionNumber, existing?.sheets ?? []),
        };
    }

    private getProblemSheets(questionNumber: string, fallback: string[]): string[] {
        const { extractArrayElements, getSheets } = require("../utils/dataUtils");
        const matchingSheets = Object.entries(getSheets())
            .filter(([, sheet]) => extractArrayElements(sheet as Record<string, string[]>).includes(questionNumber))
            .map(([sheetName]) => sheetName);
        return matchingSheets.length > 0 ? matchingSheets : fallback;
    }

    private getProblemUrl(questionNumber: string): string {
        const { globalState } = require("../globalState");
        const { getUrl } = require("../shared");
        const mapping = globalState.getTitleSlugQuestionNumberMapping();
        const titleSlug = mapping && Object.keys(mapping).find((slug) => mapping[slug] === questionNumber);
        return titleSlug ? `${getUrl("base")}/problems/${titleSlug}` : "";
    }

    private getConfiguredSheetFilters(): string[] {
        const { getSheets } = require("../utils/dataUtils");
        const { getStudySheetFilters } = require("../utils/settingUtils");
        const availableFilters = new Set(Object.keys(getSheets()));
        return getStudySheetFilters().filter((filter) => availableFilters.has(filter));
    }

    private getConfiguredTopicFilters(): string[] {
        const { getStudyTopicFilters } = require("../utils/settingUtils");
        return getStudyTopicFilters().map((filter) => filter.trim())
            .filter((filter, index, array) => filter !== "" && array.indexOf(filter) === index);
    }

    private getFilterMessages(summary: StudyFilterSummary): string[] {
        return [
            summary.sheetFilters.length > 0 ? `Sheets: ${summary.sheetFilters.join(", ")}` : "Sheets: All",
            summary.topicFilters.length > 0 ? `Topics: ${summary.topicFilters.join(", ")}` : "Topics: All",
            `New per day: ${summary.newProblemsPerDay}${summary.weekdaysOnly ? " (weekdays only)" : ""}`,
            `Matching backlog: ${summary.matchingBacklogCount} of ${summary.totalBacklogCount}`,
        ];
    }

    private getTodayEmptyLabel(summary: StudyFilterSummary): string {
        if (summary.matchingBacklogCount === 0 && (summary.sheetFilters.length > 0 || summary.topicFilters.length > 0)) {
            return "No due reviews and no backlog problems match the active study filters";
        }
        return "No due reviews or planned backlog problems";
    }

    private getFilterSectionDescription(summary: StudyFilterSummary): string {
        const parts: string[] = [];
        if (summary.sheetFilters.length > 0) { parts.push(`${summary.sheetFilters.length} sheet`); }
        if (summary.topicFilters.length > 0) { parts.push(`${summary.topicFilters.length} topic`); }
        return parts.length > 0 ? parts.join(", ") : "All";
    }

    private isDeferred(record: StudyBacklogRecord, dayKey: string): boolean {
        return Boolean(record.deferredUntil && record.deferredUntil > dayKey);
    }

    private isWeekend(date: Date): boolean {
        return date.getDay() === 0 || date.getDay() === 6;
    }

    private getDayKey(date: Date): string {
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${date.getFullYear()}-${month}-${day}`;
    }

    private addDays(date: Date, days: number): Date {
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + days);
        return nextDate;
    }

    private removeFromAllDailyPlans(state: StudyStateFile, questionNumber: string): void {
        for (const dayKey of Object.keys(state.dailyPlans)) {
            this.removeFromDailyPlan(state, dayKey, questionNumber);
        }
    }

    private removeFromDailyPlan(state: StudyStateFile, dayKey: string, questionNumber: string): void {
        const plan = state.dailyPlans[dayKey];
        if (!plan) { return; }
        const nextPlan = plan.filter((item) => item !== questionNumber);
        if (nextPlan.length === 0) { delete state.dailyPlans[dayKey]; } else { state.dailyPlans[dayKey] = nextPlan; }
    }
}

export const studyService: StudyService = new StudyService();
