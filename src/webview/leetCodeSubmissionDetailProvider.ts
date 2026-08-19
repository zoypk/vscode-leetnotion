// Copyright (c) leetnotion. All rights reserved.
// Licensed under the MIT license.

import { randomBytes } from "crypto";
import { commands, ViewColumn } from "vscode";
import { SubmissionDetailView, SubmissionHistoryItem } from "../types";
import { openUrl } from "../utils/uiUtils";
import { getUrl } from "../shared";
import { resolveLeetCodeUrl, returnToSubmissionHistory } from "../submissions/submissionHistory";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { renderSubmissionDetailHtml, resolveSubmissionDetailMessage } from "./submissionDetailHtml";
import { leetCodePastSubmissionsProvider } from "./leetCodePastSubmissionsProvider";

class LeetCodeSubmissionDetailProvider extends LeetCodeWebview {
    protected readonly viewType: string = "leetnotion.submissionDetail";

    private problemTitle: string = "Submission";
    private questionNumber: string = "";
    private submission: SubmissionHistoryItem;
    private detail: SubmissionDetailView;

    public show(problemTitle: string, questionNumber: string, submission: SubmissionHistoryItem, detail: SubmissionDetailView): void {
        const url = resolveLeetCodeUrl(submission.url, getUrl("base"));
        if (!url) {
            return;
        }
        this.problemTitle = problemTitle;
        this.questionNumber = questionNumber;
        this.submission = { ...submission, url };
        this.detail = detail;
        this.showWebviewInternal();
    }

    protected getWebviewOption(): ILeetCodeWebviewOption {
        return {
            title: `${this.problemTitle}: Submission ${this.submission.id}`,
            viewColumn: ViewColumn.Two,
        };
    }

    protected getWebviewContent(): string {
        return renderSubmissionDetailHtml({
            nonce: randomBytes(18).toString("base64"),
            problemTitle: this.problemTitle,
            questionNumber: this.questionNumber,
            submission: this.submission,
            detail: this.detail,
        });
    }

    protected async onDidReceiveMessage(value: unknown): Promise<void> {
        const message = resolveSubmissionDetailMessage(value, this.submission.id);
        if (!message) {
            return;
        }

        if (message.action === "back") {
            await returnToSubmissionHistory(
                () => leetCodePastSubmissionsProvider.revealExisting(this.questionNumber),
                async () => commands.executeCommand(
                    "leetnotion.showPastSubmissionsByQuestionNumber",
                    this.questionNumber,
                    this.problemTitle
                )
            );
        } else {
            const url = resolveLeetCodeUrl(this.submission.url, getUrl("base"));
            if (url) {
                await openUrl(url);
            }
        }
    }
}

export const leetCodeSubmissionDetailProvider: LeetCodeSubmissionDetailProvider = new LeetCodeSubmissionDetailProvider();
