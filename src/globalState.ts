import * as vscode from "vscode";
import { ExtensionStorage } from "./storage/extensionStorage";
import { Lists, Mapping, PendingSessionDetails, ProblemRatingMap, QuestionsOfList, TopicTags } from "./types";

export const CookieKey = "leetcode-cookie";
export const UserStatusKey = "leetcode-user-status";
export const TopicTagsKey = "leetcode-topic-tags";
export const DailyProblemKey = "leetcode-daily-problem";
export const NotionAccessTokenKey = "notion-access-token";
export const QuestionsDatabaseIdKey = "notion-questions-database-id";
export const SubmissionsDatabaseIdKey = "notion-submissions-database-id";
export const QuestionNumberPageIdMappingKey = "leetnotion-question-number-page-id-mapping";
export const TitleSlugQuestionNumberMappingKey = "leetnotion-title-slug-question-number-mapping";
export const NotionIntegrationStatusKey = "notion-integration-status";
export const UserQuestionTagsKey = "notion-user-question-tags";
export const PendingSessionKey = "leetnotion-template-update-pending-session";
export const LeetcodeListsKey = "leetcode-lists";
export const QuestionsOfListKey = "leetcode-questions-of-list";
export const ProblemRatingMapKey = "leetcode-problem-rating-map";
export const PinnedSheetsKey = "leetcode-pinned-sheets";

export type UserDataType = {
    isSignedIn: boolean;
    isPremium: boolean;
    username: string;
    avatar: string;
    isVerified?: boolean;
};

export type NotionIntegrationStatus = "done" | "pending";

export class GlobalState {
    private context: vscode.ExtensionContext;
    private readonly storage = new ExtensionStorage();

    public async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;
        await this.storage.initialize(context);
    }

    public setCookie(value: string): Promise<void> { return this.update(CookieKey, value); }
    public getCookie(): string | undefined { return this.get(CookieKey); }
    public setUserStatus(value: UserDataType): Promise<void> { return this.update(UserStatusKey, value); }
    public getUserStatus(): UserDataType | undefined { return this.get(UserStatusKey); }
    public removeCookie(): Promise<void> { return this.update(CookieKey, undefined); }
    public async removeAll(): Promise<void> { await this.storage.clear([CookieKey, UserStatusKey]); }
    public setTopicTags(value: TopicTags): Promise<void> { return this.update(TopicTagsKey, value); }
    public getTopicTags(): TopicTags | undefined { return this.get(TopicTagsKey); }
    public setDailyProblem(value: string): Promise<void> { return this.update(DailyProblemKey, value); }
    public getDailyProblem(): string | undefined { return this.get(DailyProblemKey); }
    public setNotionAccessToken(value: string): Promise<void> { return this.update(NotionAccessTokenKey, value); }
    public getNotionAccessToken(): string | undefined { return this.get(NotionAccessTokenKey); }
    public setQuestionsDatabaseId(value: string): Promise<void> { return this.update(QuestionsDatabaseIdKey, value); }
    public getQuestionsDatabaseId(): string | undefined { return this.get(QuestionsDatabaseIdKey); }
    public setSubmissionsDatabaseId(value: string): Promise<void> { return this.update(SubmissionsDatabaseIdKey, value); }
    public getSubmissionsDatabaseId(): string | undefined { return this.get(SubmissionsDatabaseIdKey); }
    public setQuestionNumberPageIdMapping(value: Mapping): Promise<void> { return this.update(QuestionNumberPageIdMappingKey, value); }
    public getQuestionNumberPageIdMapping(): Mapping | undefined { return this.get(QuestionNumberPageIdMappingKey); }
    public setTitleSlugQuestionNumberMapping(value: Mapping): Promise<void> { return this.update(TitleSlugQuestionNumberMappingKey, value); }
    public getTitleSlugQuestionNumberMapping(): Mapping | undefined { return this.get(TitleSlugQuestionNumberMappingKey); }
    public setNotionIntegrationStatus(value: NotionIntegrationStatus): Promise<void> { return this.update(NotionIntegrationStatusKey, value); }
    public getNotionIntegrationStatus(): NotionIntegrationStatus | undefined { return this.get(NotionIntegrationStatusKey); }
    public setUserQuestionTags(value: string[]): Promise<void> { return this.update(UserQuestionTagsKey, value); }
    public getUserQuestionTags(): string[] | undefined { return this.get(UserQuestionTagsKey); }
    public setPendingSession(value: PendingSessionDetails | undefined): Promise<void> { return this.update(PendingSessionKey, value); }
    public getPendingSession(): PendingSessionDetails | undefined { return this.get(PendingSessionKey); }
    public setLists(value: Lists | undefined): Promise<void> { return this.update(LeetcodeListsKey, value); }
    public getLists(): Lists | undefined { return this.get(LeetcodeListsKey); }
    public getProblemRatingMap(): ProblemRatingMap | undefined { return this.get(ProblemRatingMapKey); }
    public setProblemRatingMap(value: ProblemRatingMap): Promise<void> { return this.update(ProblemRatingMapKey, value); }
    public setPinnedSheets(value: string[]): Promise<void> { return this.update(PinnedSheetsKey, value); }
    public getPinnedSheets(): string[] { return this.get(PinnedSheetsKey) ?? []; }
    public isPinnedSheet(sheet: string): boolean { return this.getPinnedSheets().includes(sheet); }

    public async setQuestionsOfList(questions: QuestionsOfList, listId: string): Promise<void> {
        const saved = this.get<Record<string, QuestionsOfList>>(QuestionsOfListKey) ?? {};
        await this.update(QuestionsOfListKey, { ...saved, [listId]: questions });
    }

    public async getQuestionsOfList(listId: string): Promise<QuestionsOfList | undefined> {
        return this.get<Record<string, QuestionsOfList>>(QuestionsOfListKey)?.[listId] ?? [];
    }

    public async getWithBackgroundRefresh<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
        const cached = this.get<T>(key);
        if (cached !== undefined) {
            void fetchFn().then((refreshedValue) => this.update(key, refreshedValue)).catch(() => undefined);
            return cached;
        }
        const loadedValue = await fetchFn();
        await this.update(key, loadedValue);
        return loadedValue;
    }

    public async clearAllNotionDetails(): Promise<void> {
        await this.storage.clear([
            TopicTagsKey, DailyProblemKey, NotionAccessTokenKey, QuestionsDatabaseIdKey,
            SubmissionsDatabaseIdKey, QuestionNumberPageIdMappingKey, NotionIntegrationStatusKey,
            UserQuestionTagsKey, PendingSessionKey, LeetcodeListsKey, QuestionsOfListKey,
            ProblemRatingMapKey,
        ]);
    }

    public getExtensionUri(): vscode.Uri { return this.context.extensionUri; }
    public get<T = unknown>(key: string): T | undefined { return this.storage.get<T>(key); }
    public update(key: string, value: unknown): Promise<void> { return this.storage.update(key, value); }
}

export const globalState = new GlobalState();
