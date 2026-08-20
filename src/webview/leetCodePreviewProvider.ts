// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import { commands, Uri, ViewColumn } from "vscode";
import { explorerNodeManager } from "../explorer/explorerNodeManager";
import { globalState } from "../globalState";
import { neetCodeService } from "../integrations/neetcode/service";
import { Category, IProblem } from "../shared";
import { extractArrayElements, getSheets } from "../utils/dataUtils";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { markdownEngine } from "./markdownEngine";
import { parseLearningResources } from "./learningResources";
import {
    LearningResourcesPreviewContent,
    NeetCodePreviewContent,
    PreviewActionItem,
    PreviewDisclosure,
    renderProblemPreviewHtml,
} from "./previewHtml";
import { parseWebviewMessage } from "./webviewMessages";
import { createNonce, escapeHtml, sanitizeHtml } from "./webviewSecurity";

type PreviewAction =
    | { kind: "company"; value: string }
    | { kind: "past-submissions" }
    | { kind: "sheet"; value: string }
    | { kind: "show-problem" }
    | { kind: "tag"; value: string };

class LeetCodePreviewProvider extends LeetCodeWebview {
    protected readonly viewType: string = "leetnotion.preview";
    private actionLookup: Map<string, PreviewAction> = new Map();
    private node: IProblem;
    private description: IDescription;
    private sideMode: boolean = false;

    public isSideMode(): boolean {
        return this.sideMode;
    }

    public show(descString: string, node: IProblem, isSideMode: boolean = false): void {
        this.description = this.parseDescription(descString, node);
        this.node = node;
        this.sideMode = isSideMode;
        this.showWebviewInternal();
    }

    protected getWebviewOption(): ILeetCodeWebviewOption {
        return this.sideMode
            ? { title: "Description", viewColumn: ViewColumn.Two, preserveFocus: true }
            : { title: `${this.node.name}: Preview`, viewColumn: ViewColumn.One };
    }

    protected getWebviewContent(): string {
        const webview = this.getPanel().webview;
        const nonce = createNonce();
        this.actionLookup = new Map();

        const { title, url, category, difficulty, likes, dislikes, body } = this.description;
        const head = markdownEngine.render(`# [${title}](${url})`);
        const info = this.renderProblemInfo(category, difficulty, likes, dislikes);
        const disclosures: PreviewDisclosure[] = [
            this.createDisclosure("Tags", "tag", this.description.tags),
            this.createDisclosure("Companies", "company", this.description.companies),
            this.createDisclosure("Sheets", "sheet", this.description.sheets),
        ];
        const linkAction = this.registerAction({ kind: "past-submissions" }, "Past Submissions");
        const solveAction = this.sideMode ? undefined : this.registerAction({ kind: "show-problem" }, "Code Now");
        const externalLinks = markdownEngine.render(
            `[Submissions](${this.getSubmissionsLink(url)}) | [Solution](${this.getSolutionsLink(url)})`,
        );

        return renderProblemPreviewHtml({
            actionScriptUri: this.getActionScriptUri(),
            cspSource: webview.cspSource,
            descriptionHtml: body,
            disclosures,
            learningResources: this.getLearningResourcesContent(),
            linkActions: [linkAction],
            linksHtml: externalLinks,
            neetCode: this.getNeetCodeContent(),
            nonce,
            overviewHtml: head + info,
            solveActionId: solveAction?.id,
            stylesHtml: markdownEngine.getStyles(webview, nonce),
        });
    }

    protected onDidDisposeWebview(): void {
        super.onDidDisposeWebview();
        this.actionLookup.clear();
        this.sideMode = false;
    }

    protected async onDidReceiveMessage(message: unknown): Promise<void> {
        const parsed = parseWebviewMessage(message, { invoke: ["id"] });
        if (!parsed) {
            return;
        }
        const action = this.actionLookup.get(parsed.values.id);
        if (!action) {
            return;
        }
        switch (action.kind) {
            case "show-problem":
                await commands.executeCommand("leetnotion.showProblem", this.node);
                break;
            case "tag":
                await explorerNodeManager.revealNode(`${Category.Tag}#${action.value}`);
                break;
            case "company":
                await explorerNodeManager.revealNode(`${Category.Company}#${action.value}`);
                break;
            case "sheet":
                await explorerNodeManager.revealNode(explorerNodeManager.getSheetNodeId(action.value));
                break;
            case "past-submissions":
                await commands.executeCommand("leetnotion.showPastSubmissions", this.node);
                break;
        }
    }

    private createDisclosure(title: string, kind: "tag" | "company" | "sheet", values: readonly string[]): PreviewDisclosure {
        return {
            title,
            items: values.map((value) => this.registerAction({ kind, value }, value)),
        };
    }

    private registerAction(action: PreviewAction, label: string): PreviewActionItem {
        const id = `action-${this.actionLookup.size}`;
        this.actionLookup.set(id, action);
        return { id, label };
    }

    private getActionScriptUri(): string {
        const uri = Uri.joinPath(globalState.getExtensionUri(), "public", "scripts", "webview-actions.js");
        return this.getPanel().webview.asWebviewUri(uri).toString();
    }

    private renderProblemInfo(category: string, difficulty: string, likes: string, dislikes: string): string {
        if (!this.node.rating) {
            return markdownEngine.render([
                "| Category | Difficulty | Likes | Dislikes |",
                "| :------: | :--------: | :---: | :------: |",
                `| ${category} | ${difficulty} | ${likes} | ${dislikes} |`,
            ].join("\n"));
        }
        return markdownEngine.render([
            "| Category | Difficulty | Likes | Dislikes | Rating | Index |",
            "| :------: | :--------: | :---: | :------: | :----: | :---: |",
            `| ${category} | ${difficulty} | ${likes} | ${dislikes} | ${this.node.rating} | ${this.node.problemIndex} |`,
        ].join("\n"));
    }

    private parseDescription(descString: string, problem: IProblem): IDescription {
        const sheetsData = getSheets();
        const sheets = Object.keys(sheetsData).filter((sheetName) =>
            extractArrayElements(sheetsData[sheetName]).includes(problem.id),
        );
        const [
            , , url, , , , , , category, difficulty, likes, dislikes, , , , , ...body
        ] = descString.split("\n");
        return {
            title: problem.name,
            url,
            tags: problem.tags,
            companies: problem.companies,
            sheets,
            category: category.slice(2),
            difficulty: difficulty.slice(2),
            likes: likes.split(": ")[1].trim(),
            dislikes: dislikes.split(": ")[1].trim(),
            body: body.join("\n").replace(/<pre>[\r\n]*([^]+?)[\r\n]*<\/pre>/g, "<pre><code>$1</code></pre>"),
        };
    }

    private getNeetCodeContent(): NeetCodePreviewContent | undefined {
        const problem = neetCodeService.getProblemMetadata(this.node);
        if (!problem) {
            return undefined;
        }
        const metadata: string[] = [];
        if (problem.pattern) {
            metadata.push(`<code>${escapeHtml(problem.pattern)}</code>`);
        }
        if (problem.neetcode150) {
            metadata.push("<code>NeetCode 150</code>");
        }
        if (problem.blind75) {
            metadata.push("<code>Blind 75</code>");
        }
        const links: string[] = [];
        if (problem.problemUrl) {
            links.push(`[Open on NeetCode](${problem.problemUrl})`);
        }
        if (problem.videoUrl) {
            links.push(`[Watch Video](${problem.videoUrl})`);
        }
        const content: NeetCodePreviewContent = {
            articleHtml: problem.articleMarkdown
                ? markdownEngine.render(this.getPythonOnlyArticleMarkdown(problem.articleMarkdown))
                    .replace(/<p>(?:&lt;br&gt;|<br\s*\/?>)<\/p>/g, "")
                : undefined,
            hintHtml: problem.hintMarkdown
                ? sanitizeHtml(this.getExpandedHintMarkdown(problem.hintMarkdown))
                : undefined,
            linksHtml: links.length > 0 ? markdownEngine.render(links.join(" | ")) : undefined,
            metadataHtml: metadata.length > 0 ? `<p>${metadata.join(" ")}</p>` : undefined,
        };
        return Object.keys(content).some((key) => Boolean(content[key as keyof NeetCodePreviewContent]))
            ? content
            : undefined;
    }

    private getLearningResourcesContent(): LearningResourcesPreviewContent | undefined {
        const markdown = neetCodeService.getProblemMetadata(this.node)?.learningMarkdown;
        if (!markdown) {
            return undefined;
        }
        const parsed = parseLearningResources(markdown);
        return {
            attemptHtml: markdownEngine.render(parsed.attemptMarkdown),
            revealHtml: parsed.revealMarkdown ? markdownEngine.render(parsed.revealMarkdown) : undefined,
            groups: parsed.groups.map((group) => ({
                html: markdownEngine.render(group.markdown),
                priority: group.priority,
                title: group.title,
            })),
            returnHtml: parsed.returnMarkdown ? markdownEngine.render(parsed.returnMarkdown) : undefined,
        };
    }

    private getSolutionsLink(url: string): string {
        return url.replace("/description/", "/solutions/") + "?source=vscode";
    }

    private getSubmissionsLink(url: string): string {
        return url.replace("/description/", "/submissions/") + "?source=vscode";
    }

    private getPythonOnlyArticleMarkdown(articleMarkdown: string): string {
        const output: string[] = [];
        const lines = articleMarkdown.split(/\r?\n/);
        let inTabs = false;
        let inPythonFence = false;
        let inSkippedFence = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "::tabs-start") {
                while (output.length > 0 && output[output.length - 1].trim() === "") {
                    output.pop();
                }
                inTabs = true;
                inPythonFence = false;
                inSkippedFence = false;
                continue;
            }
            if (trimmed === "::tabs-end") {
                inTabs = false;
                inPythonFence = false;
                inSkippedFence = false;
                continue;
            }
            if (!inTabs) {
                if (!/^<br\s*\/?\s*>$/.test(trimmed)) {
                    output.push(line);
                }
                continue;
            }
            if (trimmed.startsWith("```")) {
                if (inPythonFence) {
                    output.push(line);
                    inPythonFence = false;
                    continue;
                }
                if (inSkippedFence) {
                    inSkippedFence = false;
                    continue;
                }
                const language = trimmed.slice(3).trim().toLowerCase();
                if (language === "python" || language === "python3" || language === "py" || language.startsWith("python ")) {
                    inPythonFence = true;
                    output.push(line);
                } else {
                    inSkippedFence = true;
                }
                continue;
            }
            if (inPythonFence) {
                output.push(line);
            } else if (!/^<br\s*\/?\s*>$/.test(trimmed)) {
                output.push(line);
            }
        }
        return output.join("\n");
    }

    private getExpandedHintMarkdown(hintMarkdown: string): string {
        return hintMarkdown.replace(
            /<details class="hint-accordion">/,
            '<details class="hint-accordion" open>',
        );
    }
}

interface IDescription {
    title: string;
    url: string;
    tags: string[];
    companies: string[];
    sheets: string[];
    category: string;
    difficulty: string;
    likes: string;
    dislikes: string;
    body: string;
}

export const leetCodePreviewProvider: LeetCodePreviewProvider = new LeetCodePreviewProvider();
