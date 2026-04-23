import AdvancedNotionClient, { PageObjectResponse, QueryDatabaseResponse, UpdatePageProperties } from "@leetnotion/notion-api";
import { globalState } from "./globalState";
import { LeetcodeProblem, LeetcodeSubmission, LeetnotionSubmission, Mapping, MultiSelectDatabasePropertyConfigResponse, ProblemPageResponse, QueryProblemPageProperties, SelectTags, SetPropertiesMessage } from "./types";
import { leetCodeChannel } from "./leetCodeChannel";
import { hasNotionIntegrationEnabled, shouldAddCodeToSubmissionPage, shouldUpdateStatusWhenUploadingSubmissions } from "./utils/settingUtils";
import { leetcodeClient } from "./leetCodeClient";
import * as _ from 'lodash'
import { DialogType, promptForOpenOutputChannel } from "./utils/uiUtils";
import { areArraysEqual, getNotionLang, splitTextIntoChunks } from "./utils/toolUtils";
import { leetCodeSubmissionProvider } from "./webview/leetCodeSubmissionProvider";
import { LeetCodeToNotionConverter } from "./modules/leetnotion/converter";
import Bottleneck from "bottleneck";
import { reviewService } from "./reviews/reviewService";
import { reviewTreeDataProvider } from "./reviews/reviewTreeDataProvider";
import { selectWorkspaceFolder } from "./utils/workspaceUtils";

const QuestionsDatabaseKey = "Questions Database";
const SubmissionsDatabaseKey = "Submissions Database";
const noop = () => undefined;

class LeetnotionClient {
    private notion: AdvancedNotionClient | undefined;
    private isSignedIn: boolean;
    private limiter = new Bottleneck({
        minTime: 334
    })

    public initialize() {
        const accessToken = globalState.getNotionAccessToken();
        if (accessToken) {
            this.isSignedIn = true;
            this.notion = new AdvancedNotionClient(accessToken);
        } else {
            this.isSignedIn = false;
            this.notion = undefined;
        }
    }

    public signOut() {
        this.isSignedIn = false;
        this.notion = undefined;
    }

    public async isValidAccessToken(accessToken: string): Promise<boolean> {
        const localClient = new AdvancedNotionClient(accessToken);
        const questionsDatabaseId = await localClient.getDatabaseId(QuestionsDatabaseKey);
        if (questionsDatabaseId === null) return false;
        return true;
    }

    public async setDatabaseIds() {
        if (!this.isSignedIn) return;
        const questionsDatabaseId = await this.notion?.getDatabaseId(QuestionsDatabaseKey);
        if (!questionsDatabaseId) {
            leetCodeChannel.appendLine(`Invalid notion questions database id`);
            return;
        }
        globalState.setQuestionsDatabaseId(questionsDatabaseId);
        const submissionsDatabaseId = await this.notion?.getDatabaseId(SubmissionsDatabaseKey);
        if (!submissionsDatabaseId) {
            leetCodeChannel.appendLine(`Invalid notion submissions database id`);
            return;
        }
        globalState.setSubmissionsDatabaseId(submissionsDatabaseId);
    }

    public async updateTemplateInformation(callbackFn: () => void = noop) {
        if (!this.isSignedIn) return;
        const questionsDatabaseId = globalState.getQuestionsDatabaseId();
        if (!questionsDatabaseId) return;
        const pages: ProblemPageResponse[] = await this.notion?.getAllPages(questionsDatabaseId as string, callbackFn) as ProblemPageResponse[];

        const questionNumberPageIdMapping: Mapping = {}
        pages.filter(page => page.properties['Question Number'].number !== null)
            .forEach(page => {
                const questionNumber = page.properties['Question Number'].number;
                if (!questionNumber) return;
                questionNumberPageIdMapping[questionNumber.toString()] = page.id;
            })
        globalState.setQuestionNumberPageIdMapping(questionNumberPageIdMapping);
    }

    public getPageIdOfQuestion(questionNumber: string): string | null {
        const normalizedQuestionNumber = this.normalizeQuestionNumber(questionNumber);
        const mapping: Mapping | undefined = globalState.getQuestionNumberPageIdMapping();
        if (!mapping || !mapping[normalizedQuestionNumber]) {
            return null;
        }
        return mapping[normalizedQuestionNumber];
    }

    public async submitSolution(questionNumber: string) {
        if (!hasNotionIntegrationEnabled()) return;
        try {
            const updateResponse = await this.updateStatusOfQuestion(questionNumber);
            const submission = await leetcodeClient.getRecentSubmission();
            if (!submission) {
                throw new Error(`no-recent-submission`);
            }
            const submissionPageId = await this.createSubmissionPage(questionNumber, submission);
            this.updatePanel(questionNumber, updateResponse.id, submissionPageId, this.getSelectTags(updateResponse.properties.Tags.multi_select.map(tag => tag.name)));
            await this.addCodeToPage(submissionPageId, submission.lang, submission.code);
        } catch (error) {
            promptForOpenOutputChannel(`Failed to update notion for your submission`, DialogType.error);
            leetCodeChannel.appendLine(`Failed to update notion for your submission: ${error}`);
        }
    }

    public updatePanel(questionNumber: string, questionPageId: string, submissionPageId: string, tags: SelectTags) {
        try {
            const panel = leetCodeSubmissionProvider.getPanel();
            if (!panel) {
                throw new Error('panel-not-available');
            }
            panel.webview.postMessage({ command: 'submission-done', questionNumber, questionPageId, submissionPageId, tags })
        } catch (error) {
            throw new Error(`Failed to update submission panel: ${error}`);
        }
    }

    public async updateStatusOfQuestion(questionNumber: string, check: boolean = true): Promise<PageObjectResponse<QueryProblemPageProperties>> {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error("notion-integration-not-enabled");
            }
            const pageId = this.getPageIdOfQuestion(questionNumber);
            if (!pageId) {
                throw new Error("question-not-available");
            }
            const response = await this.notion.pages.update({
                page_id: pageId,
                properties: {
                    Status: {
                        checkbox: check
                    }
                }
            })
            return response as PageObjectResponse<QueryProblemPageProperties>
        } catch (error) {
            throw new Error(`Failed to update status of question in notion: ${error}`);
        }
    }

    public async createSubmissionPage(questionNumber: string, submission: LeetnotionSubmission): Promise<string> {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error("notion-integration-not-enabled");
            }
            const pageId = this.getPageIdOfQuestion(questionNumber);
            if (!pageId) {
                throw new Error("question-not-available");
            }
            const submissionsDatabaseId = globalState.getSubmissionsDatabaseId();
            if (!submissionsDatabaseId) {
                throw new Error("no-submissions-database")
            };
            const response = await this.notion.pages.create({
                parent: {
                    database_id: submissionsDatabaseId,
                },
                properties: LeetCodeToNotionConverter.convertSubmissionToSubmissionPage(submission, pageId),
            })
            return response.id;
        } catch (error) {
            throw new Error(`Failed to create submission: ${error}`);
        }
    }

    public async addCodeToPage(pageId: string, lang: string, code: string) {
        if (!shouldAddCodeToSubmissionPage()) return;
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error("notion-integration-not-enabled");
            }
            const codeChunks = splitTextIntoChunks(code);
            await this.notion.blocks.children.append({
                block_id: pageId,
                children: [{
                    object: 'block',
                    type: 'code',
                    code: {
                        language: getNotionLang(lang),
                        rich_text: codeChunks.map(codeChunk => ({
                            text: {
                                content: codeChunk
                            }
                        }))
                    }
                }]
            })
        } catch (error) {
            throw new Error(`Failed to add code to page: ${error}`);
        }
    }

    public async setProperties(message: SetPropertiesMessage): Promise<boolean> {
        if (!hasNotionIntegrationEnabled()) return false;
        if (message.command !== "set-properties") return false;
        const tagsChanged = !areArraysEqual(message.initialTags, message.finalTags);
        const hasNotes = message.notes && message.notes.length > 0;
        try {
            const reviewDate = await this.syncReviewSchedule(message);
            const hasReviewDate = !!reviewDate;
            const questionPageProperties: UpdatePageProperties = {};
            if (hasReviewDate) {
                questionPageProperties['Review Date'] = {
                    date: {
                        start: reviewDate
                    }
                };
                questionPageProperties['Reviewed'] = {
                    checkbox: false
                };
            }
            if (tagsChanged) {
                questionPageProperties['Tags'] = {
                    multi_select: message.finalTags.map(name => ({ name }))
                };
            }

            const submissionPageProperties: UpdatePageProperties = {};
            submissionPageProperties['Note'] = {
                rich_text: [{ text: { content: message.notes } }]
            };
            submissionPageProperties['Tags'] = {
                multi_select: message.isOptimal ? [{ name: 'Optimal' }] : []
            };

            if (!this.isSignedIn || !this.notion) {
                throw new Error("notion-integration-not-enabled");
            }
            if (hasReviewDate || tagsChanged) {
                await this.notion.pages.update({
                    page_id: message.questionPageId,
                    properties: questionPageProperties
                })
            }
            if (hasNotes || message.isOptimal) {
                await this.notion.pages.update({
                    page_id: message.submissionPageId,
                    properties: submissionPageProperties
                })
            }
            let prevTags = globalState.getUserQuestionTags();
            if (!prevTags) prevTags = [];
            const allTags = Array.from(new Set([...prevTags, ...message.finalTags]));
            globalState.setUserQuestionTags(allTags);
            return true;
        } catch (error) {
            leetCodeChannel.appendLine(`Failed to set properties: ${error}`);
            promptForOpenOutputChannel(`Failed to set properties`, DialogType.error);
            return false;
        }
    }

    private async syncReviewSchedule(message: SetPropertiesMessage): Promise<string | undefined> {
        if (message.reviewRating) {
            await this.ensureReviewWorkspaceConfigured();
            await reviewService.addProblem(message.questionNumber);
            const dueAt = await reviewService.applyRating(message.questionNumber, message.reviewRating);
            await reviewTreeDataProvider.refresh();
            return this.toDateInputValue(new Date(dueAt));
        }

        if (message.reviewDate && message.reviewDate.length > 0) {
            await this.ensureReviewWorkspaceConfigured();
            await reviewService.addProblem(message.questionNumber);
            await reviewService.snoozeReview(message.questionNumber, this.parseDateInput(message.reviewDate));
            await reviewTreeDataProvider.refresh();
            return message.reviewDate;
        }

        return undefined;
    }

    private async ensureReviewWorkspaceConfigured(): Promise<void> {
        if (reviewService.isConfigured()) {
            return;
        }

        const workspaceFolder = await selectWorkspaceFolder();
        if (workspaceFolder === "" || !reviewService.isConfigured()) {
            throw new Error("local-review-workspace-not-configured");
        }
    }

    private parseDateInput(value: string): Date {
        const [year, month, day] = value.split("-").map(Number);
        if (!year || !month || !day) {
            throw new Error(`Invalid review date: ${value}`);
        }

        return new Date(year, month - 1, day);
    }

    private toDateInputValue(date: Date): string {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    public async setUserQuestionTags(): Promise<void> {
        if (!hasNotionIntegrationEnabled()) return;
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error("notion-integration-not-enabled");
            }
            const questionsDatabaseId = globalState.getQuestionsDatabaseId();
            if (!questionsDatabaseId) {
                throw new Error("questions-database-id-not-found");
            }
            const databaseProperties = await this.notion.databases.retrieve({
                database_id: questionsDatabaseId
            })
            const tags = databaseProperties.properties["Tags"] as MultiSelectDatabasePropertyConfigResponse
            const questionTags = tags.multi_select.options.map(({ name }) => name);
            globalState.setUserQuestionTags(questionTags);
        } catch (error) {
            leetCodeChannel.appendLine(`Failed to set user question tags: ${error}`);
        }
    }

    public getSelectTags(selectedTags: string[]): SelectTags {
        let existingTags = globalState.getUserQuestionTags();
        if (!existingTags) existingTags = [];
        const selectedTagsSet = new Set(selectedTags);
        const allTagsSet = new Set(existingTags);
        selectedTags.forEach(selectedTag => allTagsSet.add(selectedTag));
        const allTags = Array.from(allTagsSet);
        const selectTags: SelectTags = [];
        for (let id = 1; id <= allTags.length; id += 1) {
            selectTags.push({
                id,
                text: allTags[id - 1],
                selected: selectedTagsSet.has(allTags[id - 1])
            })
        }
        return selectTags;
    }

    public async getQuestionPages(callbackFn: () => void = noop): Promise<ProblemPageResponse[]> {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error(`notion-integration-not-enabled`);
            }
            const databaseId = globalState.getQuestionsDatabaseId();
            if (!databaseId) {
                throw new Error(`questions-database-id-not-found`);
            }
            return await this.notion.getAllPages(databaseId, callbackFn) as ProblemPageResponse[];
        } catch (error) {
            throw new Error(`Failed to get question pages: ${error}`);
        }
    }

    public async markQuestionReviewed(pageId: string, reviewDate?: string): Promise<void> {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error(`notion-integration-not-enabled`);
            }

            const properties: UpdatePageProperties = {
                Reviewed: {
                    checkbox: true,
                },
            };

            if (reviewDate) {
                properties['Review Date'] = {
                    date: {
                        start: reviewDate,
                    },
                };
            }

            await this.notion.pages.update({
                page_id: pageId,
                properties,
            });
        } catch (error) {
            throw new Error(`Failed to mark question as reviewed: ${error}`);
        }
    }

    public async scheduleQuestionReview(questionNumber: string, reviewDate: string): Promise<void> {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error(`notion-integration-not-enabled`);
            }

            const pageId = await this.getOrRefreshQuestionPageId(questionNumber);
            if (!pageId) {
                throw new Error(`question-page-not-found`);
            }

            await this.notion.pages.update({
                page_id: pageId,
                properties: {
                    'Review Date': {
                        date: {
                            start: reviewDate,
                        },
                    },
                    Reviewed: {
                        checkbox: false,
                    },
                },
            });
        } catch (error) {
            throw new Error(`Failed to schedule question review: ${error}`);
        }
    }

    private async getOrRefreshQuestionPageId(questionNumber: string): Promise<string | null> {
        const normalizedQuestionNumber = this.normalizeQuestionNumber(questionNumber);
        const cachedPageId = this.getPageIdOfQuestion(normalizedQuestionNumber);
        if (cachedPageId) {
            return cachedPageId;
        }

        await this.updateTemplateInformation();
        return this.getPageIdOfQuestion(normalizedQuestionNumber);
    }

    private normalizeQuestionNumber(questionNumber: string): string {
        const normalizedQuestionNumber = questionNumber.replace(/^0+/, "");
        return normalizedQuestionNumber.length > 0 ? normalizedQuestionNumber : "0";
    }

    public async snoozeQuestionReview(pageId: string, reviewDate: string): Promise<void> {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error(`notion-integration-not-enabled`);
            }

            await this.notion.pages.update({
                page_id: pageId,
                properties: {
                    'Review Date': {
                        date: {
                            start: reviewDate,
                        },
                    },
                    'Reviewed': {
                        checkbox: false,
                    },
                },
            });
        } catch (error) {
            throw new Error(`Failed to snooze question review: ${error}`);
        }
    }

    public async addProblems(problems: LeetcodeProblem[], callbackFn: (response: ProblemPageResponse) => void = noop): Promise<ProblemPageResponse[]> {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error(`notion-integration-not-enabled`);
            }
            const databaseId = globalState.getQuestionsDatabaseId();
            if (!databaseId) {
                throw new Error(`questions-database-id-not-found`);
            }
            const problemPages = problems.map(problem => LeetCodeToNotionConverter.convertProblemToCreatePage(problem));
            return await this.notion.addPagesToDatabase(databaseId, problemPages, callbackFn) as ProblemPageResponse[];
        } catch (error) {
            throw new Error(`Failed to add problems: ${error}`);
        }
    }

    public async updateProblems(problems: LeetcodeProblem[], callbackFn: (response: ProblemPageResponse) => void = noop): Promise<ProblemPageResponse[]> {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error(`notion-integration-not-enabled`);
            }
            const databaseId = globalState.getQuestionsDatabaseId();
            if (!databaseId) {
                throw new Error(`questions-database-id-not-found`);
            }
            const questionNumberPageIdMapping = globalState.getQuestionNumberPageIdMapping();
            if (!questionNumberPageIdMapping) {
                throw new Error(`question-number-page-id-mapping`);
            }
            const updateProperties = problems.map(problem => {
                const properties = LeetCodeToNotionConverter.convertProblemToUpdatePage(problem)
                return { pageId: questionNumberPageIdMapping[problem.questionFrontendId], properties }
            });
            return await this.notion.updatePages(updateProperties, callbackFn) as ProblemPageResponse[];
        } catch (error) {
            throw new Error(`Failed to update problems: ${error}`);
        }
    }

    public async getSubmissionPages(callbackFn: (response: QueryDatabaseResponse) => void = noop) {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error(`notion-integration-not-enabled`);
            }
            const databaseId = globalState.getSubmissionsDatabaseId();
            if (!databaseId) {
                throw new Error(`submissions-database-id-not-found`);
            }
            return await this.notion.getAllPages(databaseId, callbackFn);
        } catch (error) {
            throw new Error(`Failed to get submission pages: ${error}`);
        }
    }

    public async addSubmissions(submissions: LeetcodeSubmission[], callbackFn: () => void = noop) {
        try {
            if (!this.isSignedIn || !this.notion) {
                throw new Error(`notion-integration-not-enabled`);
            }
            const questionsDatabaseId = globalState.getQuestionsDatabaseId();
            if (!questionsDatabaseId) {
                throw new Error(`questions-database-id-not-found`);
            }
            const submissionsDatabaseId = globalState.getSubmissionsDatabaseId();
            if (!submissionsDatabaseId) {
                throw new Error(`submissions-database-id-not-found`);
            }
            const titleSlugQuestionNumberMapping = globalState.getTitleSlugQuestionNumberMapping();
            if (!titleSlugQuestionNumberMapping) {
                throw new Error(`title-slug-question-number-mapping-not-found`);
            }
            const questionNumberPageIdMapping = globalState.getQuestionNumberPageIdMapping();
            if (!questionNumberPageIdMapping) {
                throw new Error(`question-number-page-id-mapping-not-found`);
            }
            let questionsMissing = false;
            for (const submission of submissions) {
                const questionNumber = titleSlugQuestionNumberMapping[submission.title_slug];
                const pageId = questionNumberPageIdMapping[questionNumber];
                if (!pageId) {
                    questionsMissing = true;
                    continue;
                }
                if (shouldUpdateStatusWhenUploadingSubmissions()) {
                    await this.limiter.schedule(async () => await this.updateStatusOfQuestion(questionNumber))
                    leetCodeChannel.appendLine(`Updated status of question: ${submission.title_slug}`)
                }
                const submissionPageId = await this.limiter.schedule(async () =>  await this.createSubmissionPage(questionNumber, submission));
                leetCodeChannel.appendLine(`Created submission page for ${submission.id} submission`)
                if (shouldAddCodeToSubmissionPage()) {
                    await this.limiter.schedule(async () => await this.addCodeToPage(submissionPageId, submission.lang, submission.code))
                    leetCodeChannel.appendLine(`Added code to submission page for ${submission.title_slug} question`)
                }
                callbackFn();
            }
            if(questionsMissing) {
                promptForOpenOutputChannel(`Few questions are missing in the template. Submissions of other questions are added. Update the template using 'Update leetnotion template' command and run 'Add existing submissions to template' command again to add remaining submissions to template`, DialogType.warning);
            } else {
                promptForOpenOutputChannel(`Successfully added submissions to template`, DialogType.completed);
            }
        } catch (error) {
            throw new Error(`Failed to add submissions: ${error}`);
        }
    }
}

export const leetnotionClient: LeetnotionClient = new LeetnotionClient();
