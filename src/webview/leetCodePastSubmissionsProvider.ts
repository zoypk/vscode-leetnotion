// Copyright (c) leetnotion. All rights reserved.
// Licensed under the MIT license.

import { randomBytes } from "crypto";
import { commands, ViewColumn } from "vscode";
import { LeetcodeSubmission, SubmissionHistoryItem } from "../types";
import { openUrl } from "../utils/uiUtils";
import { getUrl } from "../shared";
import { keepTrustedSubmissionUrls, resolveLeetCodeUrl } from "../submissions/submissionHistory";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { renderSubmissionHistoryHtml, resolveSubmissionHistoryMessage } from "./submissionHistoryHtml";

export interface SubmissionHistoryContext {
    problemTitle: string;
    questionNumber: string;
    submission: SubmissionHistoryItem;
}

class LeetCodePastSubmissionsProvider extends LeetCodeWebview {
    protected readonly viewType: string = "leetnotion.pastSubmissions";

    private problemTitle: string = "Past Submissions";
    private questionNumber: string = "";
    private submissions: LeetcodeSubmission[] = [];
    private submissionsById = new Map<number, LeetcodeSubmission>();

    public show(problemTitle: string, questionNumber: string, submissions: LeetcodeSubmission[]): void {
        this.problemTitle = problemTitle;
        this.questionNumber = questionNumber;
        this.submissions = keepTrustedSubmissionUrls(submissions, getUrl("base"));
        this.submissionsById = new Map(this.submissions.map((submission) => [submission.id, submission]));
        this.showWebviewInternal();
    }

    public getSubmissionContext(submissionId: number): SubmissionHistoryContext | undefined {
        const submission = this.submissionsById.get(submissionId);
        if (!submission) {
            return undefined;
        }

        return {
            problemTitle: this.problemTitle,
            questionNumber: this.questionNumber,
            submission: toHistoryItem(submission, this.questionNumber),
        };
    }

    public revealExisting(questionNumber: string): boolean {
        if (!this.panel || this.questionNumber !== questionNumber) {
            return false;
        }
        this.panel.reveal(ViewColumn.Two, false);
        return true;
    }

    protected getWebviewOption(): ILeetCodeWebviewOption {
        return {
            title: `${this.problemTitle}: Past Submissions`,
            viewColumn: ViewColumn.Two,
        };
    }

    protected getWebviewContent(): string {
        return renderSubmissionHistoryHtml({
            nonce: randomBytes(18).toString("base64"),
            problemTitle: this.problemTitle,
            questionNumber: this.questionNumber,
            submissions: this.submissions,
        });
    }

    protected async onDidReceiveMessage(value: unknown): Promise<void> {
        const message = resolveSubmissionHistoryMessage(value, this.submissionsById);
        if (!message) {
            return;
        }

        if (message.action === "open-detail") {
            await commands.executeCommand("leetnotion.showSubmissionDetail", message.submissionId);
        } else {
            const url = resolveLeetCodeUrl(message.submission.url, getUrl("base"));
            if (url) {
                await openUrl(url);
            }
        }
    }
}

function toHistoryItem(submission: LeetcodeSubmission, questionNumber: string): SubmissionHistoryItem {
    return {
        id: submission.id,
        title: submission.title,
        questionNumber,
        url: submission.url,
        timestamp: submission.timestamp,
        lang: submission.lang,
        runtime: submission.runtime,
        memory: submission.memory,
        status_display: submission.status_display,
    };
}

export const leetCodePastSubmissionsProvider: LeetCodePastSubmissionsProvider = new LeetCodePastSubmissionsProvider();
