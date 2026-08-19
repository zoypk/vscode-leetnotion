// Copyright (c) leetnotion. All rights reserved.
// Licensed under the MIT license.

import { randomBytes } from "crypto";
import { commands, ViewColumn } from "vscode";
import { SubmissionDetailView, SubmissionHistoryItem } from "../types";
import { openUrl } from "../utils/uiUtils";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { renderSubmissionDetailHtml, resolveSubmissionDetailMessage } from "./submissionDetailHtml";

class LeetCodeSubmissionDetailProvider extends LeetCodeWebview {
    protected readonly viewType: string = "leetnotion.submissionDetail";

    private problemTitle: string = "Submission";
    private questionNumber: string = "";
    private submission: SubmissionHistoryItem;
    private detail: SubmissionDetailView;

    public show(problemTitle: string, questionNumber: string, submission: SubmissionHistoryItem, detail: SubmissionDetailView): void {
        this.problemTitle = problemTitle;
        this.questionNumber = questionNumber;
        this.submission = submission;
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
            await commands.executeCommand(
                "leetnotion.showPastSubmissionsByQuestionNumber",
                this.questionNumber,
                this.problemTitle
            );
        } else {
            await openUrl(this.submission.url);
        }
    }
}

export const leetCodeSubmissionDetailProvider: LeetCodeSubmissionDetailProvider = new LeetCodeSubmissionDetailProvider();
