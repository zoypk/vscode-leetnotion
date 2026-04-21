// Copyright (c) leetnotion. All rights reserved.
// Licensed under the MIT license.

import { Credential, LeetCodeAdvanced, type UserContestInfo, type UserProfile, type UserSubmission } from "@leetnotion/leetcode-api";
import { globalState } from "./globalState";
import { extractCookie } from "./utils/toolUtils";
import { DialogType, promptForOpenOutputChannel } from "./utils/uiUtils";
import { leetCodeChannel } from "./leetCodeChannel";
import { LeetcodeProblem, ProblemRatingMap } from "./types";
import axios from "axios";
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
}

export const leetcodeClient: LeetcodeClient = new LeetcodeClient();
