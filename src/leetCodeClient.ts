// Copyright (c) leetnotion. All rights reserved.
// Licensed under the MIT license.

import {
    Credential,
    LeetCodeAdvanced,
    type Submission,
    type UserContestInfo,
    type UserProfile,
    type UserSubmission,
} from "@leetnotion/leetcode-api";
import axios from "axios";
import { globalState } from "./globalState";
import { getUrl } from "./shared";
import { extractCookie } from "./utils/toolUtils";
import { DialogType, promptForOpenOutputChannel } from "./utils/uiUtils";
import { leetCodeChannel } from "./leetCodeChannel";
import { LeetcodeProblem, LeetcodeSubmission, ProblemRatingMap, SubmissionDetailView } from "./types";
import { ProblemRating } from "./shared";
import _ from "lodash";

type ProblemSubmissionsApiResponse = {
    submissions_dump: Array<{
        id?: string | number;
        url: string;
        status_display: string;
        lang: string;
        title: string;
        timestamp: number;
        runtime: string;
        memory: string;
    }>;
};

type LeetCodeGraphqlResponse<T> = {
    data?: T;
    errors?: Array<{
        message: string;
    }>;
};

type SubmissionDetailsGraphqlData = {
    submissionDetails: {
        code: string;
        runtimePercentile: number | null;
        memoryPercentile: number | null;
        statusDisplay: string | null;
        totalCorrect: number | string | null;
        totalTestcases: number | string | null;
        stdOutput: string | null;
        lastTestcase: string | null;
        runtimeError: string | null;
        compileError: string | null;
        notes: string | null;
        flagType: string | null;
    } | null;
};

type UpdateSubmissionNoteGraphqlData = {
    updateSubmissionNote: {
        ok: boolean;
        error: string | null;
    } | null;
};

const SUBMISSION_DETAILS_QUERY = `
    query submissionDetails($submissionId: Int!) {
        submissionDetails(submissionId: $submissionId) {
            code
            runtimePercentile
            memoryPercentile
            statusDisplay
            totalCorrect
            totalTestcases
            stdOutput
            lastTestcase
            runtimeError
            compileError
            notes
            flagType
        }
    }
`;

const UPDATE_SUBMISSION_NOTE_MUTATION = `
    mutation updateSubmissionNote($submissionId: ID!, $note: String, $tagIds: [Int], $flagType: SubmissionFlagTypeEnum) {
        updateSubmissionNote(submissionId: $submissionId, note: $note, tagIds: $tagIds, flagType: $flagType) {
            ok
            error
        }
    }
`;

class LeetcodeClient {
    private leetcode: LeetCodeAdvanced;
    private isSignedIn: boolean;

    public initialize() {
        const cookie = globalState.getCookie();
        if (cookie) {
            this.isSignedIn = true;
            const credential = new Credential(extractCookie(cookie));
            this.leetcode = new LeetCodeAdvanced(credential);
        } else {
            this.isSignedIn = false;
            this.leetcode = new LeetCodeAdvanced();
        }
    }

    public signOut() {
        this.isSignedIn = false;
        this.leetcode = new LeetCodeAdvanced();
    }

    public async getTopicTags() {
        return await this.leetcode.topicTags();
    }

    public async setTitleSlugQuestionNumberMapping() {
        const mapping = await this.leetcode.getTitleSlugQuestionNumberMapping();
        globalState.setTitleSlugQuestionNumberMapping(mapping);
        return mapping;
    }

    public async ensureTitleSlugQuestionNumberMapping() {
        const existingMapping = globalState.getTitleSlugQuestionNumberMapping();
        if (existingMapping && Object.keys(existingMapping).length > 0) {
            return existingMapping;
        }

        return await this.setTitleSlugQuestionNumberMapping();
    }

    public async getTitleSlugByQuestionNumber(questionNumber: string): Promise<string | undefined> {
        const mapping = await this.ensureTitleSlugQuestionNumberMapping();
        return Object.keys(mapping).find((titleSlug) => mapping[titleSlug] === questionNumber);
    }

    public async collectEasterEgg() {
        if (!this.isSignedIn) return;
        try {
            const isCollected = await this.leetcode.collectEasterEgg();
            if (isCollected) {
                promptForOpenOutputChannel(`Collected Easter Egg 🎉: +10 coins`, DialogType.completed);
            }
        } catch (error) {
            leetCodeChannel.appendLine(`Error collecting Easter Egg: ${error}`);
        }
    }

    public async checkIn() {
        if (!this.isSignedIn) return;
        try {
            const checkedIn = await this.leetcode.checkIn();
            if (checkedIn) {
                promptForOpenOutputChannel(`Checked in: +1 Coin`, DialogType.completed);
            }
        } catch (error) {
            leetCodeChannel.appendLine(`Error checking in: ${error}`);
        }
    }

    public async setDailyProblem() {
        try {
            const { question: { questionFrontendId } } = await this.leetcode.daily();
            await globalState.setDailyProblem(questionFrontendId);
        } catch (error) {
            leetCodeChannel.appendLine(`Error getting daily question: ${error}`);
        }
    }

    public async getNoOfProblems() {
        return await this.leetcode.noOfProblems();
    }

    public async getRecentSubmission() {
        if (!this.isSignedIn) {
            leetCodeChannel.appendLine('Leetcode user not signed in');
            return null;
        }
        return await this.leetcode.recentSubmission();
    }

    public async getAllSubmissions(progressCallback: (submissionCount: number) => void = () => { }): Promise<LeetcodeSubmission[]> {
        const batchSize = 100;
        const allSubmissions: LeetcodeSubmission[] = [];

        for (let offset = 0; ; offset += batchSize) {
            const submissions = await this.getSubmissions({ limit: batchSize, offset });
            allSubmissions.push(...submissions);
            progressCallback(allSubmissions.length);

            if (submissions.length < batchSize) {
                return allSubmissions;
            }
        }
    }

    public async getProblemSubmissions(questionNumber: string): Promise<LeetcodeSubmission[]> {
        const titleSlug = await this.getTitleSlugByQuestionNumber(questionNumber);
        if (!titleSlug) {
            throw new Error(`Failed to resolve title slug for problem ${questionNumber}`);
        }

        if (!this.isSignedIn) {
            throw new Error("not-signed-in-to-leetcode");
        }

        const submissions = await this.getProblemSubmissionsBySlug(titleSlug);
        return submissions.map((submission) => this.normalizeProblemSubmission(submission, titleSlug));
    }

    public async getSubmissionDetail(id: number): Promise<SubmissionDetailView> {
        const data = await this.graphqlRequest<SubmissionDetailsGraphqlData>(
            SUBMISSION_DETAILS_QUERY,
            { submissionId: id },
            `${getUrl("base")}/submissions/detail/${id}/`
        );

        if (!data.submissionDetails) {
            throw new Error(`submission-detail-not-found:${id}`);
        }

        return {
            code: data.submissionDetails.code || "",
            runtime_percentile: data.submissionDetails.runtimePercentile ?? null,
            memory_percentile: data.submissionDetails.memoryPercentile ?? null,
            notes: data.submissionDetails.notes || "",
            flag_type: data.submissionDetails.flagType || "WHITE",
            details: {
                total_correct: data.submissionDetails.totalCorrect ?? undefined,
                total_testcases: data.submissionDetails.totalTestcases ?? undefined,
                compare_result: data.submissionDetails.statusDisplay || undefined,
                status_msg: data.submissionDetails.statusDisplay || undefined,
                stdout: data.submissionDetails.stdOutput || undefined,
                testcase: data.submissionDetails.lastTestcase || undefined,
                error: [data.submissionDetails.runtimeError, data.submissionDetails.compileError].filter((value): value is string => Boolean(value)),
            },
        };
    }

    public async updateSubmissionNote(id: number, note: string, flagType: string): Promise<void> {
        const data = await this.graphqlRequest<UpdateSubmissionNoteGraphqlData>(
            UPDATE_SUBMISSION_NOTE_MUTATION,
            {
                submissionId: id.toString(),
                note,
                tagIds: [],
                flagType,
            },
            `${getUrl("base")}/submissions/detail/${id}/`
        );

        if (!data.updateSubmissionNote?.ok) {
            throw new Error(data.updateSubmissionNote?.error || `Failed to update note for submission ${id}`);
        }
    }

    public async getUserProfile(username: string): Promise<UserProfile> {
        return await this.leetcode.user(username);
    }

    public async getUserContestInfo(username: string): Promise<UserContestInfo> {
        return await this.leetcode.user_contest_info(username);
    }

    public async getRecentUserSubmissions(username: string, limit: number = 20): Promise<UserSubmission[]> {
        return await this.leetcode.recent_user_submissions(username, limit);
    }

    public async getLeetcodeProblems(progressCallback: (problems: LeetcodeProblem[]) => void = () => { }): Promise<LeetcodeProblem[]> {
        try {
            if (!this.isSignedIn) throw new Error(`not-signed-in-to-leetcode`);
            const problems = await this.leetcode.getLeetcodeProblems({ limit: 500, callbackFn: progressCallback });
            const problemTypes = await this.leetcode.getProblemTypes();
            const typedProblems = problems.map(problem => ({
                ...problem,
                type: problemTypes[problem.questionFrontendId] ? [problemTypes[problem.questionFrontendId]] : [],
            }));
            return typedProblems;
        } catch (error) {
            throw new Error(`Error getting leetcode problems: ${error}`);
        }
    }

    public async getLists() {
        try {
            if (!this.isSignedIn) throw new Error(`not-signed-in-to-leetcode`);
            const lists = await this.leetcode.getLists();
            return lists;
        } catch (error) {
            throw new Error(`Error getting leetcode lists: ${error}`);
        }
    }

    public async getQuestionsOfList(slug: string) {
        try {
            if (!this.isSignedIn) throw new Error(`not-signed-in-to-leetcode`);
            const questions = await this.leetcode.getQuestionsOfList(slug);
            return questions;
        } catch (error) {
            throw new Error(`Error getting leetcode lists: ${error}`);
        }
    }

    public async getProblemRatingsMap(): Promise<ProblemRatingMap> {
        try {
            const { data } = await axios.get("https://zerotrac.github.io/leetcode_problem_rating/data.json")
            const ratingsMap: ProblemRatingMap = {};
            for(const rating of data as ProblemRating[]) {
                rating.Rating = _.floor(rating.Rating);
                ratingsMap[rating.ID.toString()] = rating;
            }

            return ratingsMap;
        } catch (error) {
            throw new Error(`Error getting problem ratings: ${error}`);
        }
    }

    private async getSubmissions(options: { limit?: number; offset?: number; slug?: string } = {}): Promise<LeetcodeSubmission[]> {
        if (!this.isSignedIn) {
            throw new Error("not-signed-in-to-leetcode");
        }

        const submissions = await this.leetcode.submissions(options);
        return submissions.map((submission) => this.normalizeSubmission(submission));
    }

    private normalizeSubmission(submission: Submission): LeetcodeSubmission {
        return {
            code: submission.code || "",
            compare_result: submission.compare_result || "",
            flag_type: submission.flat_type || 0,
            has_notes: submission.has_notes,
            id: submission.id,
            is_pending: submission.is_pending.toString(),
            lang: submission.lang,
            lang_name: submission.lang_name,
            memory: String(submission.memory || ""),
            question_id: submission.question_id,
            runtime: submission.runtime,
            status: submission.status,
            status_display: submission.status_display,
            time: submission.time,
            timestamp: submission.timestamp,
            title: submission.title,
            title_slug: submission.title_slug,
            url: new URL(submission.url, getUrl("base")).toString(),
        };
    }

    private async getProblemSubmissionsBySlug(titleSlug: string): Promise<ProblemSubmissionsApiResponse["submissions_dump"]> {
        const cookie = globalState.getCookie();
        if (!cookie) {
            throw new Error("not-signed-in-to-leetcode");
        }

        const { csrf } = extractCookie(cookie);
        const baseUrl = getUrl("base");
        const response = await axios.get<ProblemSubmissionsApiResponse>(`${baseUrl}/api/submissions/${titleSlug}`, {
            headers: {
                "content-type": "application/json",
                origin: baseUrl,
                referer: `${baseUrl}/problems/${titleSlug}/`,
                cookie,
                "x-csrftoken": csrf || "",
                "x-requested-with": "XMLHttpRequest",
                "user-agent": "Mozilla/5.0 LeetCode API",
            },
        });

        return response.data.submissions_dump || [];
    }

    private normalizeProblemSubmission(submission: ProblemSubmissionsApiResponse["submissions_dump"][number], titleSlug: string): LeetcodeSubmission {
        const submissionId = Number(submission.id ?? submission.url.split("/").filter(Boolean).pop() ?? 0);
        return {
            code: "",
            compare_result: "",
            flag_type: 0,
            has_notes: false,
            id: submissionId,
            is_pending: "false",
            lang: submission.lang,
            lang_name: submission.lang,
            memory: submission.memory || "",
            question_id: 0,
            runtime: submission.runtime || "",
            status: 0,
            status_display: submission.status_display,
            time: "",
            timestamp: submission.timestamp,
            title: submission.title,
            title_slug: titleSlug,
            url: new URL(submission.url, getUrl("base")).toString(),
        };
    }

    private async graphqlRequest<T>(query: string, variables: Record<string, unknown>, referer: string): Promise<T> {
        if (!this.isSignedIn) {
            throw new Error("not-signed-in-to-leetcode");
        }

        const cookie = globalState.getCookie();
        if (!cookie) {
            throw new Error("not-signed-in-to-leetcode");
        }

        const { csrf } = extractCookie(cookie);
        const baseUrl = getUrl("base");
        const response = await axios.post<LeetCodeGraphqlResponse<T>>(getUrl("graphql"), {
            query,
            variables,
        }, {
            headers: {
                "content-type": "application/json",
                origin: baseUrl,
                referer,
                cookie,
                "x-csrftoken": csrf || "",
                "x-requested-with": "XMLHttpRequest",
                "user-agent": "Mozilla/5.0 LeetCode API",
            },
        });

        if (response.data.errors && response.data.errors.length > 0) {
            throw new Error(response.data.errors.map((error) => error.message).join(", "));
        }

        if (!response.data.data) {
            throw new Error("LeetCode GraphQL returned no data.");
        }

        return response.data.data;
    }
}

export const leetcodeClient: LeetcodeClient = new LeetcodeClient();
