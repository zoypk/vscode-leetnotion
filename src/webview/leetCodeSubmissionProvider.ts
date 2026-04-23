// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import * as os from "os";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { leetcodeClient } from "../leetCodeClient";
import { leetCodeChannel } from "../leetCodeChannel";
import { SetPropertiesMessage, SubmissionResultContext } from "../types";
import { DialogType, openKeybindingsEditor, promptForOpenOutputChannel, promptHintMessage } from "../utils/uiUtils";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { markdownEngine } from "./markdownEngine";
import { leetnotionEngine } from "./leetnotionEngine";
import { leetnotionClient } from "../leetnotionClient";

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
        const styles: string = [markdownEngine.getStyles(webview), this.getStyles()].join("\n");
        const scripts: string = this.getScripts();
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
        const submissionFormConfig = this.renderSubmissionFormConfigScript();
        const leetnotionBody: string = leetnotionEngine.render(webview, {
            submissionContext: this.submissionContext,
            flagOptions: this.getOrderedFlagOptions(this.submissionContext?.flagType || "WHITE").map(({ value, label }) => ({ value, label })),
        });

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-Security-Policy" content="
                    default-src 'none';
                    img-src ${webview.cspSource} https: data:;
                    script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval';
                    style-src ${webview.cspSource} 'unsafe-inline' https://*.vscode-cdn.net https://cdnjs.cloudflare.com;
                    font-src ${webview.cspSource} https://*.vscode-cdn.net https://cdnjs.cloudflare.com data:;
                ">
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${styles}
                ${scripts}
            </head>
            <body class="vscode-body 'scrollBeyondLastLine' 'wordWrap' 'showEditorSelection'" style="tab-size:4">
                ${body}
                <hr />
                ${submissionFormConfig}
                ${leetnotionBody}
            </body>
            </html>
        `;
    }

    protected async onDidReceiveMessage(message: SetPropertiesMessage): Promise<void> {
        switch (message.command) {
            case "set-properties": {
                await this.saveProperties(message);
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

    private async saveProperties(message: SetPropertiesMessage): Promise<void> {
        try {
            const hasSubmissionContext = Boolean(this.submissionContext);
            const hasNotionProperties = Boolean(message.questionPageId && message.submissionPageId);

            if (this.submissionContext) {
                await leetcodeClient.updateSubmissionNote(this.submissionContext.submissionId, message.notes || "", message.flagType || "WHITE");
            }

            if (hasNotionProperties) {
                const updated = await leetnotionClient.setProperties(message);
                if (!updated) {
                    throw new Error("notion-properties-not-updated");
                }
            }

            if (this.submissionContext) {
                this.submissionContext = {
                    ...this.submissionContext,
                    notes: message.notes || "",
                    flagType: message.flagType || "WHITE",
                };
            }

            this.getPanel()?.webview.postMessage({
                command: "submission-properties-saved",
                message: this.getSuccessMessage(hasSubmissionContext, hasNotionProperties),
                notes: this.submissionContext?.notes,
                flagType: this.submissionContext?.flagType,
            });
        } catch (error) {
            leetCodeChannel.appendLine(`Failed to save submission properties: ${error}`);
            this.getPanel()?.webview.postMessage({
                command: "submission-properties-save-failed",
                error: error instanceof Error ? error.message : String(error),
            });
            await promptForOpenOutputChannel("Failed to save submission properties. Please open the output channel for details.", DialogType.error);
        }
    }

    private getSuccessMessage(hasSubmissionContext: boolean, hasNotionProperties: boolean): string {
        if (hasSubmissionContext && hasNotionProperties) {
            return "Saved LeetCode note and Notion properties.";
        }

        if (hasSubmissionContext) {
            return "Saved to LeetCode.";
        }

        return "Properties updated.";
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

    private renderSubmissionFormConfigScript(): string {
        return `
            <script>
                window.__LEETNOTION_SUBMISSION_CONTEXT__ = ${JSON.stringify(this.submissionContext ?? null)};
                window.__LEETNOTION_SUBMISSION_FLAG_STYLES__ = ${JSON.stringify(this.getSubmissionFlagStyles())};
            </script>
        `;
    }

    private getScripts() {
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
        return scripts.map((script: vscode.Uri) => `<script src="${script.toString()}"></script>`).join(os.EOL);
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
