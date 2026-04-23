// Copyright (c) leetnotion. All rights reserved.
// Licensed under the MIT license.

import { commands, ViewColumn } from "vscode";
import { SubmissionDetailView, SubmissionHistoryItem } from "../types";
import { openUrl } from "../utils/uiUtils";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { markdownEngine } from "./markdownEngine";

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
        const webview = this.getPanel().webview;
        const styles = markdownEngine.getStyles(webview);
        const head = markdownEngine.render(`# ${this.escapeHtml(this.problemTitle)}`);
        const subtitle = `<div class="subtitle">Problem ${this.escapeHtml(this.questionNumber)} · Submission ${this.submission.id} · ${this.escapeHtml(this.submission.status_display)}</div>`;
        const runtimePercentile = this.formatPercentile(this.detail.runtime_percentile);
        const memoryPercentile = this.formatPercentile(this.detail.memory_percentile);
        const info = markdownEngine.render([
            `| Field | Value |`,
            `| :--- | :--- |`,
            `| Language | ${this.escapeHtml(this.submission.lang)} |`,
            `| Runtime | ${this.escapeHtml(this.submission.runtime || "N/A")} |`,
            `| Memory | ${this.escapeHtml(this.submission.memory || "N/A")} |`,
            `| Runtime percentile | ${runtimePercentile} |`,
            `| Memory percentile | ${memoryPercentile} |`,
            `| Total correct | ${this.escapeHtml(this.detail.details.total_correct || "N/A")} |`,
            `| Total testcases | ${this.escapeHtml(this.detail.details.total_testcases || "N/A")} |`,
            `| Result | ${this.escapeHtml(this.detail.details.compare_result || "N/A")} |`,
        ].join("\n"));
        const codeBlock = this.detail.code
            ? `<pre class="code-block"><code>${this.escapeHtml(this.detail.code)}</code></pre>`
            : `<div class="empty-state">Code is not available from LeetCode's current submission detail API. Use <strong>Open on LeetCode</strong> for the original page.</div>`;
        const extraSections = [
            this.renderTextSection("Last testcase", this.detail.details.testcase),
            this.renderTextSection("Stdout", this.detail.details.stdout),
            this.renderErrorSection(this.detail.details.error),
        ].filter(Boolean).join("");

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
                ${styles}
                <style>
                    body {
                        margin: 0;
                        padding: 16px;
                    }

                    .actions {
                        display: flex;
                        gap: 8px;
                        flex-wrap: wrap;
                        margin: 16px 0;
                    }

                    .subtitle {
                        color: var(--vscode-descriptionForeground);
                        margin-top: 6px;
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

                    .code-block {
                        margin: 16px 0 0;
                        padding: 16px;
                        overflow: auto;
                        border-radius: 8px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        font-family: var(--vscode-editor-font-family, monospace);
                        white-space: pre-wrap;
                        word-break: break-word;
                    }

                    .empty-state {
                        margin-top: 16px;
                        padding: 16px;
                        border-radius: 8px;
                        border: 1px dashed var(--vscode-panel-border);
                        color: var(--vscode-descriptionForeground);
                    }
                </style>
            </head>
            <body class="vscode-body">
                ${head}
                ${subtitle}
                ${info}
                <div class="actions">
                    <button onclick="showPastSubmissions()">Back to submissions</button>
                    <button onclick="openSubmission()">Open on LeetCode</button>
                </div>
                ${codeBlock}
                ${extraSections}
                <script>
                    const vscode = acquireVsCodeApi();

                    function showPastSubmissions() {
                        vscode.postMessage({
                            command: 'show-past-submissions',
                            questionNumber: ${JSON.stringify(this.questionNumber)},
                            title: ${JSON.stringify(this.problemTitle)},
                        });
                    }

                    function openSubmission() {
                        vscode.postMessage({
                            command: 'open-submission-url',
                            url: ${JSON.stringify(this.submission.url)},
                        });
                    }
                </script>
            </body>
            </html>
        `;
    }

    protected async onDidReceiveMessage(message: { command: string; questionNumber?: string; title?: string; url?: string }): Promise<void> {
        switch (message.command) {
            case "show-past-submissions":
                await commands.executeCommand("leetnotion.showPastSubmissionsByQuestionNumber", message.questionNumber, message.title);
                break;
            case "open-submission-url":
                if (message.url) {
                    await openUrl(message.url);
                }
                break;
            default:
                break;
        }
    }

    private escapeHtml(value: string | number): string {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    private formatPercentile(value: number | null): string {
        return typeof value === "number" ? value.toFixed(2) : "N/A";
    }

    private renderTextSection(title: string, value?: string): string {
        if (!value) {
            return "";
        }

        return `
            <h2>${this.escapeHtml(title)}</h2>
            <pre class="code-block"><code>${this.escapeHtml(value)}</code></pre>
        `;
    }

    private renderErrorSection(errors?: string[]): string {
        if (!errors || errors.length === 0) {
            return "";
        }

        return `
            <h2>Errors</h2>
            <pre class="code-block"><code>${this.escapeHtml(errors.join("\n\n"))}</code></pre>
        `;
    }
}

export const leetCodeSubmissionDetailProvider: LeetCodeSubmissionDetailProvider = new LeetCodeSubmissionDetailProvider();
