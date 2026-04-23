import * as vscode from "vscode";
import { SubmissionResultContext } from "../types";
import { hasNotionIntegrationEnabled } from "../utils/settingUtils";
import { globalState } from "../globalState";

type SubmissionFlagOption = {
    value: string;
    label: string;
};

type RenderOptions = {
    submissionContext?: SubmissionResultContext;
    flagOptions: SubmissionFlagOption[];
};

class LeetnotionEngine implements vscode.Disposable {

    private notionIntegrationEnabled: boolean;
    private listener: vscode.Disposable;

    public constructor() {
        this.reload();
        this.listener = vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration("leetnotion.enableNotionIntegration")) {
                this.reload();
            }
        }, this);
    }

    public get localResourceRoots(): vscode.Uri[] {
        return [
            vscode.Uri.joinPath(globalState.getExtensionUri(), "public"),
            vscode.Uri.joinPath(globalState.getExtensionUri(), "out", "src")
        ];
    }

    public dispose(): void {
        this.listener.dispose();
    }

    public reload(): void {
        this.notionIntegrationEnabled = hasNotionIntegrationEnabled();
    }

    public render(webview: vscode.Webview, options: RenderOptions): string {
        if(!this.notionIntegrationEnabled && !options.submissionContext) return "";

        const flagOptions = options.flagOptions.map((option) => `<vscode-option value="${this.escapeHtml(option.value)}">${this.escapeHtml(option.label)}</vscode-option>`).join("");

        return `<div id="setPropertiesSection">
                    <div id="setPropertiesInputSection">
                        <div id="leetcode-properties-section">
                            <vscode-text-area autofocus cols="50" rows="10" resize="both" id="notes-input">
                                <div id="notes-label">LeetCode Note</div>
                            </vscode-text-area>
                            <div id="submission-flag-container">
                                <label id="submission-flag-label" for="submission-flag-select">LeetCode Color</label>
                                <div id="submission-flag-controls">
                                    <vscode-dropdown id="submission-flag-select" position="below">
                                        ${flagOptions}
                                    </vscode-dropdown>
                                    <div id="submission-flag-preview" aria-live="polite">
                                        <span id="submission-flag-preview-dot"></span>
                                        <span id="submission-flag-preview-label"></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div id="notion-properties-section">
                            <div id="review-container">
                                <label id="review-label" for="absolute-review-date-container">Review schedule</label>
                                <div id="review-inputs">
                                    <div id="absolute-review-date-container">
                                        <input type="date" id="review-date-input" value="" />
                                    </div>
                                    <div id="review-rating-buttons" role="group" aria-label="FSRS review rating">
                                        <button type="button" class="review-rating-button" data-rating="again" title="Missed the answer. Schedule the card again soon.">Again</button>
                                        <button type="button" class="review-rating-button" data-rating="hard" title="Remembered with difficulty. Schedule it a bit sooner.">Hard</button>
                                        <button type="button" class="review-rating-button" data-rating="good" title="Remembered normally. Use the standard FSRS interval.">Good</button>
                                        <button type="button" class="review-rating-button" data-rating="easy" title="Remembered effortlessly. Stretch the next interval.">Easy</button>
                                    </div>
                                    <p id="review-hint">Pick a calendar date or let FSRS schedule from a rating.</p>
                                </div>
                            </div>
                            <vscode-checkbox id="optimal-checkbox-input">Optimal Solution</vscode-checkbox>
                            <vscode-divider></vscode-divider>
                            <label id="tags-label" for="tags-box">Tags</label>
                            <div id="tags-box">
                                <select class="form-control" multiple="multiple" id="tags-select">
                                </select>
                            </div>
                        </div>
                        <p id="submission-properties-status" aria-live="polite"></p>
                        <vscode-button id="setPropertiesButton" appearance="primary">Save</vscode-button>
                    </div>
                </div>
                <script type="module" src="${this.getLeetnotionScript(webview)}"></script>
                <script type="module" src="${this.getVscodeComponentsUri(webview)}"></script>`
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    private getLeetnotionScript(webview: vscode.Webview): string {
        const onDiskPath = vscode.Uri.joinPath(
            globalState.getExtensionUri(),
            "public",
            "scripts",
            "script.js",
        );
        return webview.asWebviewUri(onDiskPath).toString();
    }

    private getVscodeComponentsUri(webview: vscode.Webview): string {
        const onDiskPath = vscode.Uri.joinPath(
            globalState.getExtensionUri(),
            "public",
            "scripts",
            "vscode-components.js",
        );
        return webview.asWebviewUri(onDiskPath).toString();
    }
}

export const leetnotionEngine: LeetnotionEngine = new LeetnotionEngine();
