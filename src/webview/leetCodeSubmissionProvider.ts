// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import * as os from "os";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { leetcodeClient } from "../leetCodeClient";
import { leetCodeChannel } from "../leetCodeChannel";
import { globalState } from "../globalState";
import { SubmissionDetailView, SubmissionResultContext } from "../types";
import { DialogType, openKeybindingsEditor, promptForOpenOutputChannel, promptHintMessage } from "../utils/uiUtils";
import { hasNotionIntegrationEnabled } from "../utils/settingUtils";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { markdownEngine } from "./markdownEngine";
import { leetnotionEngine } from "./leetnotionEngine";
import { leetnotionClient } from "../leetnotionClient";
import type { ValidatedSubmission } from "../submissions/types";
import { AuthoritativeSubmissionState, buildLeetCodeSubmissionUpdate } from "../notion/submissionProperties";
import { parseSubmissionPropertiesMessage, SubmissionPropertiesMessage } from "./submissionMessages";
import { createNonce, createWebviewCsp, escapeAttribute, serializeJsonForHtml } from "./webviewSecurity";
import {
    reviewEditKey,
    SubmissionNotionContext,
    SubmissionSaveCoordinator,
} from "./submissionSaveCoordinator";

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
    private submissionDetail?: SubmissionDetailView;
    private notionContext?: SubmissionNotionContext;
    private savedState?: AuthoritativeSubmissionState;
    private readonly saveCoordinator = new SubmissionSaveCoordinator();
    private saveQueue: Promise<void> = Promise.resolve();

    public show(resultString: string, validatedSubmission?: ValidatedSubmission): void {
        this.result = this.parseResult(resultString);
        this.submissionContext = validatedSubmission ? {
            questionNumber: validatedSubmission.questionNumber,
            submissionId: validatedSubmission.submission.id,
            title: validatedSubmission.submission.title,
            notes: validatedSubmission.detail.notes,
            flagType: validatedSubmission.detail.flag_type,
        } : undefined;
        this.submissionDetail = validatedSubmission?.detail;
        this.notionContext = undefined;
        this.savedState = this.submissionContext ? {
            notes: this.submissionContext.notes,
            flagType: this.submissionContext.flagType || "WHITE",
            isOptimal: false,
            tags: [],
            reviewDate: null,
        } : {
            notes: "",
            flagType: "WHITE",
            isOptimal: false,
            tags: [],
            reviewDate: null,
        };
        this.saveCoordinator.begin(
            this.submissionContext,
            this.savedState,
            this.shouldWaitForNotionContext(validatedSubmission),
        );
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
        const nonce = createNonce();
        const styles: string = [markdownEngine.getStyles(webview, nonce), this.getStyles()].join("\n");
        const scripts: string = this.getScripts(nonce);
        const body: string = this.renderResultBody();
        const leetnotionBody: string = leetnotionEngine.render(webview, {
            submissionContext: this.submissionContext,
            flagOptions: this.getOrderedFlagOptions(this.submissionContext?.flagType || "WHITE").map(({ value, label }) => ({ value, label })),
            configJson: serializeJsonForHtml(this.getPublicFormConfig()),
            nonce,
        });

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(createWebviewCsp(webview.cspSource, nonce))}">
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${styles}
                ${scripts}
            </head>
            <body class="vscode-body scrollBeyondLastLine wordWrap showEditorSelection">
                ${body}
                <hr />
                ${leetnotionBody}
            </body>
            </html>
        `;
    }

    protected async onDidReceiveMessage(value: unknown): Promise<void> {
        const receivedGeneration = this.saveCoordinator.currentGeneration;
        let message: SubmissionPropertiesMessage;
        try {
            message = parseSubmissionPropertiesMessage(value);
        } catch (error) {
            leetCodeChannel.appendLine(`Rejected submission properties message: ${error}`);
            this.getPanel()?.webview.postMessage({
                command: "submission-properties-save-failed",
                error: "The submitted properties were invalid.",
            });
            return;
        }
        const run = async () => {
            await this.saveProperties(message, receivedGeneration);
        };
        const queued = this.saveQueue.then(run, run);
        this.saveQueue = queued.catch(() => undefined);
        await queued;
    }

    public installNotionContext(context: SubmissionNotionContext): boolean {
        const currentState = this.saveCoordinator.currentState;
        const nextState = {
            ...currentState,
            tags: context.tags.filter(({ selected }) => selected).map(({ text }) => text),
            reviewDate: context.reviewDate,
        };
        if (!this.saveCoordinator.installNotionContext(context, nextState)) {
            leetCodeChannel.appendLine(`Ignored stale Notion panel context for submission ${context.submissionId}.`);
            return false;
        }
        this.notionContext = {
            ...context,
            tags: context.tags.map((tag) => ({ ...tag })),
        };
        this.savedState = nextState;
        const panel = this.getPanel();
        if (!panel) {
            return false;
        }
        panel.webview.postMessage({
            command: "submission-form-state",
            state: this.savedState,
            hasNotionProperties: true,
            notionPending: false,
            tagOptions: context.tags.map(({ text }) => text),
        });
        return true;
    }

    public markNotionContextUnavailable(submissionId: number, questionNumber: string): boolean {
        if (!this.saveCoordinator.markNotionUnavailable({ submissionId, questionNumber })) {
            return false;
        }
        const panel = this.getPanel();
        panel?.webview.postMessage({
            command: "submission-form-state",
            state: this.saveCoordinator.currentState,
            hasNotionProperties: false,
            notionPending: false,
            tagOptions: [],
        });
        return Boolean(panel);
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

    private renderResultBody(): string {
        const mergedResult: IResult = {
            ...this.result,
        };

        const status = this.submissionDetail?.details.compare_result
            || this.submissionDetail?.details.status_msg
            || this.result.messages[0]
            || "";
        const isAccepted = status === "Accepted";

        if (this.submissionDetail?.details.testcase) {
            mergedResult[isAccepted ? "Your Input" : "Testcase"] = [this.submissionDetail.details.testcase];
        }

        if (this.submissionDetail?.details.stdout) {
            mergedResult["Stdout"] = [this.submissionDetail.details.stdout];
        }

        if (!isAccepted) {
            if (mergedResult["Output (0 ms)"]?.length) {
                mergedResult["Output"] = mergedResult["Output (0 ms)"];
                delete mergedResult["Output (0 ms)"];
            }

            if (mergedResult["Expected Answer"]?.length) {
                mergedResult["Expected"] = mergedResult["Expected Answer"];
                delete mergedResult["Expected Answer"];
            }
        }

        this.result = mergedResult;

        const title: string = `## ${this.result.messages[0]}`;
        const messages: string[] = this.result.messages.slice(1).map((message: string) => `* ${message}`);
        const sections: string[] = Object.keys(this.result)
            .filter((key: string) => key !== "messages")
            .filter((key: string) => this.result[key] && this.result[key].length > 0)
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
            <div id="submission-result">
                ${body}
            </div>
        `;
    }

    private getSectionValues(sectionNames: string[]): string[] {
        for (const sectionName of sectionNames) {
            const values = this.result[sectionName];
            if (values && values.length > 0) {
                return values;
            }
        }

        return [];
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    private formatPercentile(value: number | null): string {
        return typeof value === "number" ? value.toFixed(2) : "N/A";
    }

    private renderSummaryRow(label: string, value: string | number | undefined): string {
        if (value === undefined || value === null || value === "") {
            return "";
        }

        return `
            <tr>
                <td>${this.escapeHtml(label)}</td>
                <td>${this.escapeHtml(String(value))}</td>
            </tr>
        `;
    }

    private renderSection(title: string, value?: string): string {
        if (!value) {
            return "";
        }

        return `
            <h3>${this.escapeHtml(title)}</h3>
            <pre><code>${this.escapeHtml(value)}</code></pre>
        `;
    }

    private renderErrorSection(errors?: string[]): string {
        if (!errors || errors.length === 0) {
            return "";
        }

        return this.renderSection("Errors", errors.join("\n\n"));
    }

    private async saveProperties(message: SubmissionPropertiesMessage, generation: number): Promise<void> {
        try {
            const snapshot = this.saveCoordinator.snapshotForSave(message.review, generation);
            const hasSubmissionContext = Boolean(snapshot.submissionContext);
            const hasNotionProperties = Boolean(snapshot.notionContext);

            if (!snapshot.submissionContext && !snapshot.notionContext) {
                throw new Error("submission-properties-context-unavailable");
            }

            if (snapshot.submissionContext) {
                const leetCodeUpdate = buildLeetCodeSubmissionUpdate({
                    ...snapshot.savedState,
                    notes: message.notes,
                    flagType: message.flagType,
                });
                await leetcodeClient.updateSubmissionNote(
                    snapshot.submissionContext.submissionId,
                    leetCodeUpdate.notes,
                    leetCodeUpdate.flagType,
                );
            }

            const questionNumber = snapshot.submissionContext?.questionNumber ?? snapshot.notionContext!.questionNumber;
            const key = reviewEditKey(message.review);
            const hasCommittedReview = this.saveCoordinator.hasCommittedReview(snapshot.generation, key);
            const committedReviewDate = this.saveCoordinator.getCommittedReview(snapshot.generation, key);
            const savedState = await leetnotionClient.setProperties(message, {
                questionNumber,
                questionPageId: snapshot.notionContext?.questionPageId,
                submissionPageId: snapshot.notionContext?.submissionPageId,
            }, snapshot.savedState, {
                committedReview: hasCommittedReview ? { key, reviewDate: committedReviewDate! } : undefined,
                onReviewCommitted: (committedKey, reviewDate) => {
                    this.saveCoordinator.recordCommittedReview(snapshot.generation, committedKey, reviewDate);
                },
            });

            const installedState = this.saveCoordinator.installSaved(
                snapshot.generation,
                savedState,
                snapshot.notionRevision,
            );
            if (!installedState) {
                leetCodeChannel.appendLine(`Suppressed stale save completion for submission generation ${snapshot.generation}.`);
                return;
            }
            this.savedState = installedState;

            if (snapshot.submissionContext) {
                this.submissionContext = {
                    ...snapshot.submissionContext,
                    notes: installedState.notes,
                    flagType: installedState.flagType,
                };
            }

            this.getPanel()?.webview.postMessage({
                command: "submission-properties-saved",
                message: this.getSuccessMessage(hasSubmissionContext, hasNotionProperties),
                state: installedState,
                hasNotionProperties: Boolean(this.notionContext),
                notionPending: this.saveCoordinator.notionPending,
                tagOptions: this.getTagOptions(),
            });
        } catch (error) {
            leetCodeChannel.appendLine(`Failed to save submission properties: ${error}`);
            if (this.saveCoordinator.isCurrent(generation)) {
                this.getPanel()?.webview.postMessage({
                    command: "submission-properties-save-failed",
                    error: error instanceof Error && error.message === "notion-context-pending"
                        ? "Wait for the matching Notion submission before scheduling a review."
                        : error instanceof Error ? error.message : String(error),
                });
                await promptForOpenOutputChannel("Failed to save submission properties. Please open the output channel for details.", DialogType.error);
            }
        }
    }

    private getSuccessMessage(hasSubmissionContext: boolean, hasNotionProperties: boolean): string {
        if (hasSubmissionContext && hasNotionProperties) {
            return "Saved LeetCode note, review, and Notion properties.";
        }

        if (hasSubmissionContext) {
            return "Saved LeetCode note and review.";
        }

        return "Saved Notion properties.";
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

    private getPublicFormConfig(): object {
        return {
            state: this.savedState ?? {
                notes: "",
                flagType: "WHITE",
                isOptimal: false,
                tags: [],
                reviewDate: null,
            },
            hasLeetCodeProperties: Boolean(this.submissionContext),
            hasNotionProperties: Boolean(this.notionContext),
            notionPending: this.saveCoordinator.notionPending,
            tagOptions: this.getTagOptions(),
        };
    }

    private getTagOptions(): string[] {
        return this.notionContext?.tags.map(({ text }) => text) ?? [];
    }

    private shouldWaitForNotionContext(validatedSubmission?: ValidatedSubmission): boolean {
        if (!validatedSubmission || !hasNotionIntegrationEnabled()) {
            return false;
        }
        const status = validatedSubmission.detail.details.status_msg
            ?? validatedSubmission.detail.details.compare_result;
        return typeof status === "string" && status.trim().toLocaleLowerCase("en-US") === "accepted";
    }

    private getScripts(nonce: string) {
        let scripts: vscode.Uri[] = [];
        try {
            const scriptPaths = ["jquery.min.js", "select2.min.js"];
            scripts = scriptPaths.map((scriptPath: string) => {
                const onDiskPath = vscode.Uri.joinPath(
                    globalState.getExtensionUri(),
                    "public",
                    "scripts",
                    scriptPath,
                );
                return this.panel
                    ? this.panel.webview.asWebviewUri(onDiskPath)
                    : onDiskPath;
            });
        } catch (error) {
            leetCodeChannel.appendLine("[Error] Failed to load built-in script file.");
        }
        return scripts.map((script: vscode.Uri) => `<script nonce="${escapeAttribute(nonce)}" src="${escapeAttribute(script.toString())}"></script>`).join(os.EOL);
    }

    public getStyles(): string {
        let styles: vscode.Uri[] = [];
        try {
            const stylePaths: string[] = ["select2.min.css", "style.css"];
            styles = stylePaths.map((stylePath: string) => {
                const onDiskPath = vscode.Uri.joinPath(
                    globalState.getExtensionUri(),
                    "public",
                    "styles",
                    stylePath,
                );
                return this.panel
                    ? this.panel.webview.asWebviewUri(onDiskPath)
                    : onDiskPath;
            });
        } catch (error) {
            leetCodeChannel.appendLine("[Error] Failed to load built-in style file.");
        }
        return styles.map((style: vscode.Uri) => `<link rel="stylesheet" type="text/css" href="${style.toString()}">`).join(os.EOL);
    }
}

interface IResult {
    [key: string]: string[];
    messages: string[];
}

export const leetCodeSubmissionProvider: LeetCodeSubmissionProvider = new LeetCodeSubmissionProvider();
