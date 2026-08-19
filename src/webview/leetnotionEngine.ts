import * as vscode from "vscode";
import { SubmissionResultContext } from "../types";
import { hasNotionIntegrationEnabled } from "../utils/settingUtils";
import { globalState } from "../globalState";
import { renderSubmissionFormHtml } from "./submissionFormState";

type SubmissionFlagOption = {
    value: string;
    label: string;
};

type RenderOptions = {
    submissionContext?: SubmissionResultContext;
    flagOptions: SubmissionFlagOption[];
    configJson: string;
    nonce: string;
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

        return renderSubmissionFormHtml({
            configJson: options.configJson,
            flagOptions: options.flagOptions,
            nonce: options.nonce,
            scriptUri: this.getLeetnotionScript(webview),
            selectedFlagType: options.submissionContext?.flagType || "WHITE",
            toolkitUri: this.getVscodeComponentsUri(webview),
        });
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
