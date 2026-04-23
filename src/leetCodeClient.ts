// Copyright (c) leetnotion. All rights reserved.
// Licensed under the MIT license.

import {
    Credential,
    LeetCodeAdvanced,
    type Submission,
    type SubmissionDetail,
    type ProblemSubmission,
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
import { LeetcodeProblem, LeetcodeSubmission, ProblemRatingMap } from "./types";
import { ProblemRating } from "./shared";
import _ from "lodash";

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

    public async getSubmissionDetail(id: number): Promise<SubmissionDetail> {
        if (!this.isSignedIn) {
            throw new Error("not-signed-in-to-leetcode");
        }

        return await this.leetcode.submission(id);
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

    private async getProblemSubmissionsBySlug(titleSlug: string): Promise<ProblemSubmission[]> {
        const leetcode = this.leetcode as LeetCodeAdvanced & {
            problemSubmissions(slug: string): Promise<ProblemSubmission[]>;
        };
        return await leetcode.problemSubmissions(titleSlug);
    }

    private normalizeProblemSubmission(submission: ProblemSubmission, titleSlug: string): LeetcodeSubmission {
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
}

export const leetcodeClient: LeetcodeClient = new LeetcodeClient();
