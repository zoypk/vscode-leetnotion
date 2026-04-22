// Copyright (c) leetnotion. All rights reserved.
// Licensed under the MIT license.

import { ViewColumn } from "vscode";
import { LeetcodeSubmission } from "@/types";
import { openUrl } from "@/utils/uiUtils";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";

class LeetCodePastSubmissionsProvider extends LeetCodeWebview {
    protected readonly viewType: string = "leetnotion.pastSubmissions";

    private problemTitle: string = "Past Submissions";
    private questionNumber: string = "";
    private submissions: LeetcodeSubmission[] = [];

    public show(problemTitle: string, questionNumber: string, submissions: LeetcodeSubmission[]): void {
        this.problemTitle = problemTitle;
        this.questionNumber = questionNumber;
        this.submissions = submissions;
        this.showWebviewInternal();
    }

    protected getWebviewOption(): ILeetCodeWebviewOption {
        return {
            title: `${this.problemTitle}: Past Submissions`,
            viewColumn: ViewColumn.Two,
        };
    }

    protected getWebviewContent(): string {
        const items = this.submissions.length > 0
            ? this.submissions.map((submission) => this.renderSubmission(submission)).join("\n")
            : `<div class="empty-state">No past submissions found for problem ${this.questionNumber}.</div>`;

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-editor-foreground);
                        background: var(--vscode-editor-background);
                        margin: 0;
                        padding: 16px;
                    }

                    h1 {
                        font-size: 20px;
                        margin: 0 0 6px;
                    }

                    .subtitle {
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 16px;
                    }

                    .submission {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 8px;
                        padding: 14px;
                        margin-bottom: 12px;
                        background: var(--vscode-sideBar-background);
                    }

                    .submission-header {
                        display: flex;
                        justify-content: space-between;
                        gap: 12px;
                        flex-wrap: wrap;
                        margin-bottom: 10px;
                    }

                    .status {
                        font-weight: 600;
                    }

                    .meta {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                        gap: 8px 12px;
                        font-size: 13px;
                    }

                    .meta-label {
                        color: var(--vscode-descriptionForeground);
                    }

                    button {
                        border: 0;
                        border-radius: 6px;
                        padding: 6px 10px;
                        cursor: pointer;
                        color: var(--vscode-button-foreground);
                        background: var(--vscode-button-background);
                    }

                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }

                    .empty-state {
                        border: 1px dashed var(--vscode-panel-border);
                        border-radius: 8px;
                        padding: 16px;
                        color: var(--vscode-descriptionForeground);
                    }
                </style>
            </head>
            <body>
                <h1>${this.escapeHtml(this.problemTitle)}</h1>
                <div class="subtitle">${this.submissions.length} submission${this.submissions.length === 1 ? "" : "s"} found for problem ${this.escapeHtml(this.questionNumber)}</div>
                ${items}
                <script>
                    const vscode = acquireVsCodeApi();

                    function openSubmission(url) {
                        vscode.postMessage({ command: 'open-submission', url });
                    }
                </script>
            </body>
            </html>
        `;
    }

    protected async onDidReceiveMessage(message: { command: string; url: string }): Promise<void> {
        if (message.command === "open-submission") {
            await openUrl(message.url);
        }
    }

    private renderSubmission(submission: LeetcodeSubmission): string {
        return `
            <section class="submission">
                <div class="submission-header">
                    <div>
                        <div class="status">${this.escapeHtml(submission.status_display)}</div>
                        <div>${this.escapeHtml(this.formatTimestamp(submission.timestamp))}</div>
                    </div>
                    <button onclick="openSubmission(${JSON.stringify(submission.url)})">Open on LeetCode</button>
                </div>
                <div class="meta">
                    <div><span class="meta-label">Submission ID:</span> ${this.escapeHtml(submission.id.toString())}</div>
                    <div><span class="meta-label">Language:</span> ${this.escapeHtml(submission.lang)}</div>
                    <div><span class="meta-label">Runtime:</span> ${this.escapeHtml(submission.runtime || "N/A")}</div>
                    <div><span class="meta-label">Memory:</span> ${this.escapeHtml(submission.memory || "N/A")}</div>
                </div>
            </section>
        `;
    }

    private formatTimestamp(timestamp: number): string {
        return new Date(timestamp * 1000).toLocaleString();
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
}

export const leetCodePastSubmissionsProvider: LeetCodePastSubmissionsProvider = new LeetCodePastSubmissionsProvider();
