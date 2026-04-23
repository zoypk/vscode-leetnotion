import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { globalState } from "../globalState";
import { getUrl } from "../shared";
import { reviewService } from "../reviews/reviewService";
import {
    getStudyNewProblemsPerDay,
    getStudySheetFilters,
    getStudyTopicFilters,
    shouldUseStudyWeekdaysOnly,
} from "../utils/settingUtils";
import { extractArrayElements, getSheets } from "../utils/dataUtils";
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
import { studyStorage } from "./studyStorage";

class StudyService {
    public isConfigured(): boolean {
        return studyStorage.isConfigured();
    }

    public async getSections(): Promise<StudySection[]> {
        const [todayItems, backlogItems, filterSummary] = await Promise.all([
            this.getTodayItems(),
            this.getBacklogItems(),
            this.getFilterSummary(),
        ]);

        return [
            {
                id: StudySectionId.Today,
                label: "Today",
                description: `${todayItems.length}`,
                emptyLabel: this.getTodayEmptyLabel(filterSummary),
                items: todayItems,
            },
            {
                id: StudySectionId.Backlog,
                label: "Backlog",
                description: `${backlogItems.length}`,
                emptyLabel: "No backlog problems yet",
                items: backlogItems,
            },
            {
                id: StudySectionId.Filters,
                label: "Filters",
                description: this.getFilterSectionDescription(filterSummary),
                emptyLabel: "No study filters configured",
                items: this.getFilterMessages(filterSummary),
            },
        ];
    }

    public async getTodayItems(): Promise<StudyTodayItem[]> {
        const [reviewItems, state] = await Promise.all([
            reviewService.getDueItems(),
            studyStorage.load(),
        ]);
        const plan = await this.getDailyPlan(state, new Date());

        return [
            ...reviewItems.map((review) => ({
                kind: "review" as const,
                id: `study-review-${review.questionNumber}`,
                review,
            })),
            ...plan
                .map((questionNumber) => state.backlog[questionNumber])
                .filter((record): record is StudyBacklogRecord => Boolean(record))
                .map((record) => ({
                    kind: "new" as const,
                    ...this.toBacklogItem(record, new Set(plan)),
                })),
        ];
    }

    public async getNextTodayItem(): Promise<StudyTodayItem | undefined> {
        const items = await this.getTodayItems();
        return items[0];
    }

    public async getBacklogItems(): Promise<StudyBacklogItem[]> {
        const state = await studyStorage.load();
        const todayPlan = new Set(await this.getDailyPlan(state, new Date()));

        return Object.values(state.backlog)
            .sort((left, right) => left.addedAt.localeCompare(right.addedAt) || Number(left.questionNumber) - Number(right.questionNumber))
            .map((record) => this.toBacklogItem(record, todayPlan));
    }

    public async getFilterSummary(): Promise<StudyFilterSummary> {
        const backlogItems = await this.getBacklogItems();
        return {
            sheetFilters: this.getActiveStudySheetFilters(),
            topicFilters: this.getActiveStudyTopicFilters(),
            matchingBacklogCount: backlogItems.filter((item) => item.matchesActiveFilters).length,
            totalBacklogCount: backlogItems.length,
            newProblemsPerDay: this.getTodayNewProblemLimit(new Date()),
            weekdaysOnly: shouldUseStudyWeekdaysOnly(),
        };
    }

    public async addProblem(questionNumber: string): Promise<"added" | "updated"> {
        const state = await studyStorage.load();
        const nowIso = new Date().toISOString();
        const existingRecord = state.backlog[questionNumber];

        state.backlog[questionNumber] = {
            questionNumber,
            problem: this.resolveProblemSnapshot(questionNumber, existingRecord?.problem),
            addedAt: existingRecord?.addedAt ?? nowIso,
            updatedAt: nowIso,
            deferredUntil: undefined,
        };

        await studyStorage.save(state);
        return existingRecord ? "updated" : "added";
    }

    public async removeProblem(questionNumber: string): Promise<void> {
        const state = await studyStorage.load();
        delete state.backlog[questionNumber];
        this.removeFromAllDailyPlans(state, questionNumber);
        await studyStorage.save(state);
    }

    public async completeProblem(questionNumber: string): Promise<void> {
        await this.removeProblem(questionNumber);
    }

    public async deferProblemUntilTomorrow(questionNumber: string): Promise<void> {
        const state = await studyStorage.load();
        const record = state.backlog[questionNumber];
        if (!record) {
            throw new Error(`Study backlog record ${questionNumber} was not found.`);
        }

        const tomorrowKey = this.getDayKey(this.addDays(new Date(), 1));
        state.backlog[questionNumber] = {
            ...record,
            problem: this.resolveProblemSnapshot(questionNumber, record.problem),
            updatedAt: new Date().toISOString(),
            deferredUntil: tomorrowKey,
        };
        this.removeFromDailyPlan(state, this.getDayKey(new Date()), questionNumber);
        await studyStorage.save(state);
    }

    public async clearDailyPlan(questionNumber: string): Promise<void> {
        const state = await studyStorage.load();
        this.removeFromDailyPlan(state, this.getDayKey(new Date()), questionNumber);
        await studyStorage.save(state);
    }

    public getActiveStudySheetFilters(): string[] {
        const sheets = getSheets();
        const availableFilters = new Set(Object.keys(sheets));
        return getStudySheetFilters().filter((filter) => availableFilters.has(filter));
    }

    public getActiveStudyTopicFilters(): string[] {
        return getStudyTopicFilters()
            .map((filter) => filter.trim())
            .filter((filter, index, array) => filter !== "" && array.indexOf(filter) === index);
    }

    private async getDailyPlan(state: StudyStateFile, date: Date): Promise<string[]> {
        const dayKey = this.getDayKey(date);
        const currentPlan = (state.dailyPlans[dayKey] ?? []).filter((questionNumber) => {
            const record = state.backlog[questionNumber];
            return Boolean(record) && !this.isDeferred(record, dayKey);
        });
        const targetCount = this.getTodayNewProblemLimit(date);
        const nextPlan = currentPlan.slice(0, targetCount);

        if (targetCount > nextPlan.length) {
            for (const record of this.getEligibleBacklogRecords(state, dayKey)) {
                if (nextPlan.includes(record.questionNumber)) {
                    continue;
                }

                nextPlan.push(record.questionNumber);
                if (nextPlan.length >= targetCount) {
                    break;
                }
            }
        }

        if (!this.areStringArraysEqual(state.dailyPlans[dayKey] ?? [], nextPlan)) {
            state.dailyPlans[dayKey] = nextPlan;
            await studyStorage.save(state);
        }

        return nextPlan;
    }

    private getEligibleBacklogRecords(state: StudyStateFile, dayKey: string): StudyBacklogRecord[] {
        return Object.values(state.backlog)
            .filter((record) => !this.isDeferred(record, dayKey) && this.matchesActiveFilters(record))
            .sort((left, right) => left.addedAt.localeCompare(right.addedAt) || Number(left.questionNumber) - Number(right.questionNumber));
    }

    private matchesActiveFilters(record: StudyBacklogRecord): boolean {
        const sheetFilters = this.getActiveStudySheetFilters();
        const topicFilters = this.getActiveStudyTopicFilters();

        const matchesSheets = sheetFilters.length === 0
            || sheetFilters.some((filter) => record.problem.sheets.includes(filter));
        const matchesTopics = topicFilters.length === 0
            || topicFilters.some((filter) => record.problem.tags.includes(filter));

        return matchesSheets && matchesTopics;
    }

    private toBacklogItem(record: StudyBacklogRecord, todayPlan: Set<string>): StudyBacklogItem {
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
            matchesActiveFilters: this.matchesActiveFilters(record),
            deferredUntil: record.deferredUntil,
        };
    }

    private resolveProblemSnapshot(questionNumber: string, existingSnapshot?: StudyProblemSnapshot): StudyProblemSnapshot {
        const problem = explorerNodeManager.getNodeById(questionNumber);
        return {
            name: problem?.name ?? existingSnapshot?.name ?? `Problem ${questionNumber}`,
            difficulty: problem?.difficulty ?? existingSnapshot?.difficulty ?? "",
            url: existingSnapshot?.url ?? this.getProblemUrl(questionNumber),
            tags: problem?.tags ?? existingSnapshot?.tags ?? [],
            sheets: this.getProblemSheets(questionNumber, existingSnapshot?.sheets ?? []),
        };
    }

    private getProblemSheets(questionNumber: string, fallback: string[]): string[] {
        const matchingSheets = Object.entries(getSheets())
            .filter(([, sheet]) => extractArrayElements(sheet).includes(questionNumber))
            .map(([sheetName]) => sheetName);
        return matchingSheets.length > 0 ? matchingSheets : fallback;
    }

    private getProblemUrl(questionNumber: string): string {
        const mapping = globalState.getTitleSlugQuestionNumberMapping();
        if (!mapping) {
            return "";
        }

        const titleSlug = Object.keys(mapping).find((slug) => mapping[slug] === questionNumber);
        return titleSlug ? `${getUrl("base")}/problems/${titleSlug}` : "";
    }

    private getFilterMessages(summary: StudyFilterSummary): string[] {
        const sheetMessage = summary.sheetFilters.length > 0
            ? `Sheets: ${summary.sheetFilters.join(", ")}`
            : "Sheets: All";
        const topicMessage = summary.topicFilters.length > 0
            ? `Topics: ${summary.topicFilters.join(", ")}`
            : "Topics: All";
        const paceMessage = `New per day: ${summary.newProblemsPerDay}${summary.weekdaysOnly ? " (weekdays only)" : ""}`;
        const backlogMessage = `Matching backlog: ${summary.matchingBacklogCount} of ${summary.totalBacklogCount}`;

        return [sheetMessage, topicMessage, paceMessage, backlogMessage];
    }

    private getTodayEmptyLabel(summary: StudyFilterSummary): string {
        if (summary.totalBacklogCount === 0) {
            return "No due reviews or planned backlog problems";
        }

        if (summary.matchingBacklogCount === 0 && (summary.sheetFilters.length > 0 || summary.topicFilters.length > 0)) {
            return "No due reviews and no backlog problems match the active study filters";
        }

        return "No due reviews or planned backlog problems";
    }

    private getFilterSectionDescription(summary: StudyFilterSummary): string {
        const parts: string[] = [];
        if (summary.sheetFilters.length > 0) {
            parts.push(`${summary.sheetFilters.length} sheet`);
        }
        if (summary.topicFilters.length > 0) {
            parts.push(`${summary.topicFilters.length} topic`);
        }
        return parts.length > 0 ? parts.join(", ") : "All";
    }

    private getTodayNewProblemLimit(date: Date): number {
        if (shouldUseStudyWeekdaysOnly() && this.isWeekend(date)) {
            return 0;
        }

        return Math.max(0, getStudyNewProblemsPerDay());
    }

    private isDeferred(record: StudyBacklogRecord, dayKey: string): boolean {
        return Boolean(record.deferredUntil && record.deferredUntil > dayKey);
    }

    private isWeekend(date: Date): boolean {
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    private getDayKey(date: Date): string {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${year}-${month}-${day}`;
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
        if (!plan) {
            return;
        }

        state.dailyPlans[dayKey] = plan.filter((item) => item !== questionNumber);
        if (state.dailyPlans[dayKey].length === 0) {
            delete state.dailyPlans[dayKey];
        }
    }

    private areStringArraysEqual(left: string[], right: string[]): boolean {
        if (left.length !== right.length) {
            return false;
        }

        return left.every((value, index) => value === right[index]);
    }
}

export const studyService: StudyService = new StudyService();
