// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import { ViewColumn } from "vscode";
import { leetcodeClient } from "../leetCodeClient";
import { leetCodeChannel } from "../leetCodeChannel";
import { SubmissionResultContext } from "../types";
import { DialogType, openKeybindingsEditor, promptForOpenOutputChannel, promptHintMessage } from "../utils/uiUtils";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { markdownEngine } from "./markdownEngine";

type SubmissionWebviewMessage = {
    command: string;
    submissionId?: number | null;
    notes?: string;
    flagType?: string;
};

type SubmissionFlagOption = {
    value: string;
    label: string;
    accent: string;
    background: string;
    foreground?: string;
};

const SUBMISSION_FLAG_OPTIONS: SubmissionFlagOption[] = [
    { value: "WHITE", label: "White", accent: "#9ca3af", background: "rgba(148, 163, 184, 0.16)" },
    { value: "RED", label: "Red", accent: "#ef4444", background: "rgba(239, 68, 68, 0.16)" },
    { value: "ORANGE", label: "Orange", accent: "#f97316", background: "rgba(249, 115, 22, 0.16)" },
    { value: "YELLOW", label: "Yellow", accent: "#facc15", background: "rgba(250, 204, 21, 0.18)", foreground: "#3f3200" },
    { value: "GREEN", label: "Green", accent: "#22c55e", background: "rgba(34, 197, 94, 0.16)" },
    { value: "BLUE", label: "Blue", accent: "#3b82f6", background: "rgba(59, 130, 246, 0.16)" },
    { value: "PURPLE", label: "Purple", accent: "#a855f7", background: "rgba(168, 85, 247, 0.16)" },
];

class LeetCodeSubmissionProvider extends LeetCodeWebview {

    protected readonly viewType: string = "leetnotion.submission";
    private result: IResult;
    private submissionContext?: SubmissionResultContext;

    public show(resultString: string, submissionContext?: SubmissionResultContext): void {
        this.result = this.parseResult(resultString);
        this.submissionContext = submissionContext;
        this.showWebviewInternal();
        this.showKeybindingsHint();
    }

    protected getWebviewOption(): ILeetCodeWebviewOption {
        return {
            title: "Submission",
            viewColumn: ViewColumn.Two,
        };
    }

    protected getWebviewContent(): string {
        const webview = this.panel.webview;
        const title: string = `## ${this.result.messages[0]}`;
        const messages: string[] = this.result.messages.slice(1).map((message: string) => `* ${message}`);
        const sections: string[] = Object.keys(this.result)
            .filter((key: string) => key !== "messages")
            .map((key: string) => [
                `### ${key}`,
                "```",
                this.result[key].join("\n"),
                "```",
            ].join("\n"));
        const body: string = markdownEngine.render([
            title,
            ...messages,
            ...sections,
        ].join("\n"));

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${markdownEngine.getStyles(webview)}
                <style>
                    body {
                        padding: 16px;
                    }

                    .submission-note-section {
                        margin-top: 24px;
                        padding: 16px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 10px;
                        background: var(--vscode-sideBar-background);
                    }

                    .submission-note-header {
                        display: flex;
                        justify-content: space-between;
                        gap: 12px;
                        flex-wrap: wrap;
                        align-items: flex-start;
                    }

                    .submission-note-title {
                        font-size: 16px;
                        font-weight: 600;
                    }

                    .submission-note-subtitle {
                        margin-top: 4px;
                        color: var(--vscode-descriptionForeground);
                        font-size: 12px;
                    }

                    .submission-note-form {
                        display: grid;
                        gap: 12px;
                        margin-top: 16px;
                    }

                    .submission-note-grid {
                        display: grid;
                        grid-template-columns: minmax(0, 1fr) 180px;
                        gap: 12px;
                    }

                    .submission-note-label {
                        display: block;
                        margin-bottom: 6px;
                        font-size: 12px;
                        font-weight: 600;
                        color: var(--vscode-descriptionForeground);
                        text-transform: uppercase;
                        letter-spacing: 0.04em;
                    }

                    .submission-note-textarea,
                    .submission-note-select {
                        width: 100%;
                        border: 1px solid var(--vscode-input-border, transparent);
                        border-radius: 8px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        font: inherit;
                        box-sizing: border-box;
                    }

                    .submission-note-textarea {
                        min-height: 132px;
                        padding: 12px;
                        resize: vertical;
                    }

                    .submission-note-select {
                        padding: 10px 12px;
                    }

                    .submission-note-preview {
                        min-height: 42px;
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                        padding: 0 12px;
                        border-radius: 999px;
                        border: 1px solid transparent;
                        font-size: 12px;
                        font-weight: 600;
                        box-sizing: border-box;
                    }

                    .submission-note-preview-dot {
                        width: 10px;
                        height: 10px;
                        border-radius: 999px;
                        background: currentColor;
                    }

                    .submission-note-actions {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        flex-wrap: wrap;
                    }

                    .submission-note-save {
                        border: 0;
                        border-radius: 8px;
                        padding: 8px 14px;
                        cursor: pointer;
                        color: var(--vscode-button-foreground);
                        background: var(--vscode-button-background);
                        font: inherit;
                    }

                    .submission-note-save:hover {
                        background: var(--vscode-button-hoverBackground);
                    }

                    .submission-note-save:disabled {
                        cursor: default;
                        opacity: 0.7;
                    }

                    .submission-note-status {
                        min-height: 18px;
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                    }

                    .submission-note-status.error {
                        color: var(--vscode-errorForeground);
                    }

                    @media (max-width: 720px) {
                        .submission-note-grid {
                            grid-template-columns: 1fr;
                        }
                    }
                </style>
            </head>
            <body class="vscode-body 'scrollBeyondLastLine' 'wordWrap' 'showEditorSelection'" style="tab-size:4">
                ${body}
                ${this.renderSubmissionNoteSection()}
                <script>
                    const vscode = acquireVsCodeApi();
                    const submissionFlagStyles = ${JSON.stringify(this.getSubmissionFlagStyles())};

                    function updateSubmissionFlagPreview() {
                        const select = document.getElementById('submission-flag-select');
                        const preview = document.getElementById('submission-flag-preview');
                        const previewLabel = document.getElementById('submission-flag-preview-label');
                        if (!select || !preview || !previewLabel) {
                            return;
                        }

                        const style = submissionFlagStyles[select.value] || submissionFlagStyles.WHITE;
                        preview.style.background = style.background;
                        preview.style.borderColor = style.accent;
                        preview.style.color = style.foreground || style.accent;
                        previewLabel.textContent = style.label;
                    }

                    function setSubmissionNoteStatus(message, isError) {
                        const status = document.getElementById('submission-note-status');
                        if (!status) {
                            return;
                        }

                        status.textContent = message || '';
                        status.classList.toggle('error', Boolean(isError));
                    }

                    function setSubmissionNoteSaving(isSaving) {
                        const button = document.getElementById('save-submission-note-button');
                        if (!button) {
                            return;
                        }

                        button.disabled = isSaving;
                        button.textContent = isSaving ? 'Saving...' : 'Save to LeetCode';
                    }

                    function saveSubmissionNote() {
                        const notes = document.getElementById('submission-note-input');
                        const flagType = document.getElementById('submission-flag-select');
                        if (!notes || !flagType) {
                            return;
                        }

                        setSubmissionNoteSaving(true);
                        setSubmissionNoteStatus('Saving note...', false);
                        vscode.postMessage({
                            command: 'save-submission-note',
                            submissionId: ${JSON.stringify(this.submissionContext?.submissionId ?? null)},
                            notes: notes.value,
                            flagType: flagType.value,
                        });
                    }

                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        switch (message.command) {
                            case 'submission-note-saved':
                                setSubmissionNoteSaving(false);
                                setSubmissionNoteStatus('Saved to LeetCode.', false);
                                break;
                            case 'submission-note-save-failed':
                                setSubmissionNoteSaving(false);
                                setSubmissionNoteStatus(message.error || 'Failed to save note.', true);
                                break;
                            default:
                                break;
                        }
                    });

                    updateSubmissionFlagPreview();
                </script>
            </body>
            </html>
        `;
    }

    protected async onDidReceiveMessage(message: SubmissionWebviewMessage): Promise<void> {
        switch (message.command) {
            case "save-submission-note": {
                if (typeof message.submissionId !== "number") {
                    break;
                }

                await this.saveSubmissionNote(message.submissionId, message.notes || "", message.flagType || "WHITE");
                break;
            }
            default: {
                break;
            }
        }
    }

    private async showKeybindingsHint(): Promise<void> {
        await promptHintMessage(
            "hint.commandShortcut",
            'You can customize shortcut key bindings in File > Preferences > Keyboard Shortcuts with query "leetcode".',
            "Open Keybindings",
            (): Promise<any> => openKeybindingsEditor("leetcode solution"),
        );
    }

    private parseResult(raw: string): IResult {
        raw = raw.concat("  √ ");
        const regSplit: RegExp = /  [√×✔✘vx] ([^]+?)\n(?=  [√×✔✘vx] )/g;
        const regKeyVal: RegExp = /(.+?): ([^]*)/;
        const result: IResult = { messages: [] };
        let entry: RegExpExecArray | null;
        do {
            entry = regSplit.exec(raw);
            if (!entry) {
                continue;
            }
            const kvMatch: RegExpExecArray | null = regKeyVal.exec(entry[1]);
            if (kvMatch) {
                const [key, value] = kvMatch.slice(1);
                if (value) {
                    if (!result[key]) {
                        result[key] = [];
                    }
                    result[key].push(value);
                }
            } else {
                result.messages.push(entry[1]);
            }
        } while (entry);
        return result;
    }

    private async saveSubmissionNote(submissionId: number, notes: string, flagType: string): Promise<void> {
        try {
            await leetcodeClient.updateSubmissionNote(submissionId, notes, flagType);
            if (this.submissionContext && this.submissionContext.submissionId === submissionId) {
                this.submissionContext = {
                    ...this.submissionContext,
                    notes,
                    flagType,
                };
            }

            this.getPanel()?.webview.postMessage({ command: "submission-note-saved" });
        } catch (error) {
            leetCodeChannel.appendLine(`Failed to save submission note: ${error}`);
            this.getPanel()?.webview.postMessage({
                command: "submission-note-save-failed",
                error: error instanceof Error ? error.message : String(error),
            });
            await promptForOpenOutputChannel("Failed to save the submission note to LeetCode. Please open the output channel for details.", DialogType.error);
        }
    }

    private renderSubmissionNoteSection(): string {
        if (!this.submissionContext) {
            return "";
        }

        return `
            <section class="submission-note-section">
                <div class="submission-note-header">
                    <div>
                        <div class="submission-note-title">LeetCode Submission Note</div>
                        <div class="submission-note-subtitle">Problem ${this.escapeHtml(this.submissionContext.questionNumber)} · Submission ${this.submissionContext.submissionId}</div>
                    </div>
                </div>
                <div class="submission-note-form">
                    <div class="submission-note-grid">
                        <div>
                            <label class="submission-note-label" for="submission-note-input">Note</label>
                            <textarea id="submission-note-input" class="submission-note-textarea" placeholder="Add private notes for this submission...">${this.escapeHtml(this.submissionContext.notes)}</textarea>
                        </div>
                        <div>
                            <label class="submission-note-label" for="submission-flag-select">Color</label>
                            <select id="submission-flag-select" class="submission-note-select" onchange="updateSubmissionFlagPreview()">
                                ${this.renderSubmissionFlagOptions(this.submissionContext.flagType)}
                            </select>
                            <div style="margin-top: 12px;">
                                <div id="submission-flag-preview" class="submission-note-preview">
                                    <span class="submission-note-preview-dot"></span>
                                    <span id="submission-flag-preview-label"></span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="submission-note-actions">
                        <button id="save-submission-note-button" class="submission-note-save" onclick="saveSubmissionNote()">Save to LeetCode</button>
                        <div id="submission-note-status" class="submission-note-status"></div>
                    </div>
                </div>
            </section>
        `;
    }

    private renderSubmissionFlagOptions(selectedFlagType: string): string {
        const options = this.getOrderedFlagOptions(selectedFlagType);
        return options.map((option) => `<option value="${this.escapeHtml(option.value)}"${option.value === selectedFlagType ? " selected" : ""}>${this.escapeHtml(option.label)}</option>`).join("");
    }

    private getOrderedFlagOptions(selectedFlagType: string): SubmissionFlagOption[] {
        if (SUBMISSION_FLAG_OPTIONS.some((option) => option.value === selectedFlagType)) {
            return SUBMISSION_FLAG_OPTIONS;
        }

        return [
            ...SUBMISSION_FLAG_OPTIONS,
            {
                value: selectedFlagType,
                label: selectedFlagType,
                accent: "#9ca3af",
                background: "rgba(148, 163, 184, 0.16)",
            },
        ];
    }

    private getSubmissionFlagStyles(): Record<string, SubmissionFlagOption> {
        return this.getOrderedFlagOptions(this.submissionContext?.flagType || "WHITE").reduce<Record<string, SubmissionFlagOption>>((styles, option) => {
            styles[option.value] = option;
            return styles;
        }, {});
    }

    private escapeHtml(value: string): string {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
}

interface IResult {
    [key: string]: string[];
    messages: string[];
}

export const leetCodeSubmissionProvider: LeetCodeSubmissionProvider = new LeetCodeSubmissionProvider();
