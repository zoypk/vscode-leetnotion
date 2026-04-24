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

        const selectedFlagType = options.submissionContext?.flagType || "WHITE";
        const selectedFlagValue = this.escapeHtml(selectedFlagType);
        const swatches = options.flagOptions.map((option) => {
            const value = this.escapeHtml(option.value);
            const label = this.escapeHtml(option.label);
            const isSelected = option.value === selectedFlagType;
            return `<button type="button" class="submission-flag-swatch${isSelected ? " selected" : ""}" data-flag-value="${value}" role="radio" aria-checked="${isSelected ? "true" : "false"}" aria-label="${label}" title="${label}">
                        <span class="submission-flag-swatch-check" aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" class="submission-flag-swatch-icon">
                                <path fill-rule="evenodd" d="M9.688 15.898l-3.98-3.98a1 1 0 00-1.415 1.414L8.98 18.02a1 1 0 001.415 0L20.707 7.707a1 1 0 00-1.414-1.414l-9.605 9.605z" clip-rule="evenodd"></path>
                            </svg>
                        </span>
                    </button>`;
        }).join("");

        return `<div id="setPropertiesSection">
                    <div id="setPropertiesInputSection">
                        <div id="leetcode-properties-section">
                            <vscode-text-area autofocus cols="8" rows="6" resize="both" id="notes-input">
                                <div id="notes-label">LeetCode Note</div>
                            </vscode-text-area>
                            <div id="submission-flag-container">
                                <details>
                                <div id="submission-flag-label">LeetCode Color</div>
                                <div id="submission-flag-swatches" role="radiogroup" aria-labelledby="submission-flag-label">
                                    ${swatches}
                                </div>
                                <input type="hidden" id="submission-flag-select" value="${selectedFlagValue}" />
                                </details>
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
