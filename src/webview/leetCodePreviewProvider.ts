// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import { commands, ViewColumn } from "vscode";
import { getLeetCodeEndpoint } from "../commands/plugin";
import { neetCodeService } from "../integrations/neetcode/service";
import { Category, Endpoint, IProblem } from "../shared";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { markdownEngine } from "./markdownEngine";
import { explorerNodeManager } from "@/explorer/explorerNodeManager";
import { extractArrayElements, getSheets } from "@/utils/dataUtils";

class LeetCodePreviewProvider extends LeetCodeWebview {
    protected readonly viewType: string = "leetnotion.preview";
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
        if (!this.sideMode) {
            return {
                title: `${this.node.name}: Preview`,
                viewColumn: ViewColumn.One,
            };
        } else {
            return {
                title: "Description",
                viewColumn: ViewColumn.Two,
                preserveFocus: true,
            };
        }
    }

    protected getWebviewContent(): string {
        const button: { element: string; script: string; style: string } = {
            element: `<button id="solve">Code Now</button>`,
            script: `const button = document.getElementById('solve');
                    button.onclick = () => vscode.postMessage({
                        command: 'ShowProblem',
                    });`,
            style: `<style>
                #solve {
                    position: fixed;
                    bottom: 1rem;
                    right: 1rem;
                    border: 0;
                    margin: 1rem 0;
                    padding: 0.2rem 1rem;
                    color: white;
                    background-color: var(--vscode-button-background);
                }
                #solve:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                #solve:active {
                    border: 0;
                }
                </style>`,
        };
        const { title, url, category, difficulty, likes, dislikes, body } = this.description;
        const neetCodeSection: string = this.getNeetCodeSection();
        const head: string = markdownEngine.render(`# [${title}](${url})`);
        let info: string;
        if(!this.node.rating) {
            info = markdownEngine.render(
                [
                    `| Category | Difficulty | Likes | Dislikes |`,
                    `| :------: | :--------: | :---: | :------: |`,
                    `| ${category} | ${difficulty} | ${likes} | ${dislikes} |`,
                ].join("\n")
            );
        } else {
            info = markdownEngine.render(
                [
                    `| Category | Difficulty | Likes | Dislikes | Rating | Index |`,
                    `| :------: | :--------: | :---: | :------: | :----: | :---: |`,
                    `| ${category} | ${difficulty} | ${likes} | ${dislikes} | ${this.node.rating} | ${this.node.problemIndex}`,
                ].join("\n")
            );
        }
        const tags: string = [
            `<details>`,
            `<summary><strong>Tags</strong></summary>`,
            this.description.tags.map((t: string) =>
                `<a href="#" onclick="onTagClick('${t}')"><code>${t}</code></a>`
            ).join(" | "),
            `</details>`,
        ].join("\n");
        const companies: string = [
            `<summary><strong>Companies</strong></summary>`,
            this.description.companies.map((c: string) =>
                `<a href="#" onclick="onCompanyClick('${c}')"><code>${c}</code></a>`
            ).join(" | "),
        ].join("\n");
        const sheets: string = this.description.sheets.length > 0 ? [
            // `<details>`,
            `<summary><strong>Sheets</strong></summary>`,
            this.description.sheets.map((sheet: string) =>
                `<a href="#" onclick="onSheetClick('${sheet}')"><code>${sheet}</code></a>`
            ).join(" | "),
            // `</details>`,
        ].join("\n") : "";
        const submissionsHtml: string = markdownEngine.render(
            `[Submissions](${this.getSubmissionsLink(url)}) | [Solution](${this.getSolutionsLink(url)})`
        );
        const submissionsHtmlNoP: string = submissionsHtml.replace(/^\s*<p>/i, "").replace(/<\/p>\s*$/i, "");
        const links: string = `<p>${submissionsHtmlNoP} | <a href="#" onclick="showPastSubmissions()">Past Submissions</a></p>`;
        const quickNavItems: string[] = [
            `<a href="#overview">Overview</a>`,
            `<a href="#description">Description</a>`,
            neetCodeSection ? `<a href="#neetcode">NeetCode</a>` : "",
            `<a href="#links">Links</a>`,
        ].filter(Boolean);
        const quickNav: string = quickNavItems.length > 1
            ? `<nav class="quick-nav" aria-label="Quick navigation">${quickNavItems.join("")}</nav>`
            : "";
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; script-src vscode-resource: 'unsafe-inline'; style-src vscode-resource: 'unsafe-inline';"/>
                ${markdownEngine.getStyles(this.getPanel().webview)}
                ${!this.sideMode ? button.style : ""}
                <style>
                    html {
                        scroll-behavior: smooth;
                    }
                    section {
                        scroll-margin-top: 4rem;
                    }
                    .quick-nav {
                        position: sticky;
                        top: 0;
                        z-index: 1;
                        display: flex;
                        flex-wrap: wrap;
                        gap: 0.5rem;
                        margin: 1rem 0;
                        padding: 0.75rem 0;
                        background: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.35)));
                    }
                    .quick-nav a {
                        padding: 0.2rem 0.6rem;
                        border-radius: 999px;
                        text-decoration: none;
                        color: var(--vscode-textLink-foreground);
                        background: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.16));
                    }
                    .quick-nav a:hover {
                        background: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.28));
                    }
                    code { white-space: pre-wrap; }
                    #neetcode-section details.hint-accordion {
                        margin-bottom: 0;
                    }
                    #neetcode-section details.hint-accordion + details {
                        margin-top: 0;
                    }
                </style>
            </head>
            <body>
                <section id="overview">
                    ${head}
                    ${info}
                </section>
                ${quickNav}
                ${this.description.tags.length > 0 ? `<section id="tags">${tags}</section>` : ""}
                ${this.description.companies.length > 0 ? `<section id="companies">${companies}</section>` : ""}
                ${this.description.sheets.length > 0 ? `<section id="sheets">${sheets}</section>` : ""}
                <section id="description">
                    <hr />
                    ${body}
                </section>
                ${neetCodeSection ? `<section id="neetcode">${neetCodeSection}</section>` : ""}
                <section id="links">
                    <hr />
                    ${links}
                </section>
                ${!this.sideMode ? button.element : ""}
                <script>
                    const vscode = acquireVsCodeApi();
                    ${!this.sideMode ? button.script : ""}
                    function onTagClick(tag) {
                        vscode.postMessage({ command: 'TagClick', tag });
                    }
                    function onCompanyClick(company) {
                        vscode.postMessage({ command: 'CompanyClick', company });
                    }
                    function onSheetClick(sheet) {
                        vscode.postMessage({ command: 'SheetClick', sheet });
                    }
                    function showPastSubmissions() {
                        vscode.postMessage({ command: 'ShowPastSubmissions' });
                    }
                </script>
            </body>
            </html>
        `;
    }

    protected onDidDisposeWebview(): void {
        super.onDidDisposeWebview();
        this.sideMode = false;
    }

    protected async onDidReceiveMessage(message: IWebViewMessage): Promise<void> {
        switch (message.command) {
            case "ShowProblem": {
                await commands.executeCommand("leetnotion.showProblem", this.node);
                break;
            }
            case "TagClick": {
                explorerNodeManager.revealNode(`${Category.Tag}#${message.tag}`);
                break;
            }
            case "CompanyClick": {
                explorerNodeManager.revealNode(`${Category.Company}#${message.company}`);
                break;
            }
            case "SheetClick": {
                explorerNodeManager.revealNode(explorerNodeManager.getSheetNodeId(message.sheet));
                break;
            }
            case "ShowPastSubmissions": {
                await commands.executeCommand("leetnotion.showPastSubmissions", this.node);
                break;
            }
        }
    }

    // private async hideSideBar(): Promise<void> {
    //     await commands.executeCommand("workbench.action.focusSideBar");
    //     await commands.executeCommand("workbench.action.toggleSidebarVisibility");
    // }

    private parseDescription(descString: string, problem: IProblem): IDescription {
        const sheetsData = getSheets();
        const sheets = Object.keys(sheetsData).filter((sheetName: string) =>
            extractArrayElements(sheetsData[sheetName]).includes(problem.id)
        );
        const [
            ,
            ,
            /* title */ url,
            ,
            ,
            ,
            ,
            ,
            /* tags */ /* langs */ category,
            difficulty,
            likes,
            dislikes,
            ,
            ,
            ,
            ,
            /* accepted */ /* submissions */ /* testcase */ ...body
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

    private getNeetCodeSection(): string {
        const problem = neetCodeService.getProblemMetadata(this.node);
        if (!problem) {
            return "";
        }

        const metadata: string[] = [];
        if (problem.pattern) {
            metadata.push(`<code>${problem.pattern}</code>`);
        }
        if (problem.neetcode150) {
            metadata.push(`<code>NeetCode 150</code>`);
        }
        if (problem.blind75) {
            metadata.push(`<code>Blind 75</code>`);
        }

        const links: string[] = [];
        if (problem.problemUrl) {
            links.push(`[Open on NeetCode](${problem.problemUrl})`);
        }
        if (problem.videoUrl) {
            links.push(`[Watch Video](${problem.videoUrl})`);
        }

        const hasContent = metadata.length > 0 || links.length > 0 || Boolean(problem.hintMarkdown) || Boolean(problem.articleMarkdown);
        if (!hasContent) {
            return "";
        }

        const sections: string[] = ["<hr />", "<h2>NeetCode</h2>", `<div id="neetcode-section">`];
        if (metadata.length > 0) {
            sections.push(`<p>${metadata.join(" ")}</p>`);
        }
        if (links.length > 0) {
            sections.push(markdownEngine.render(links.join(" | ")));
        }
        if (problem.hintMarkdown) {
            sections.push(this.getExpandedHintMarkdown(problem.hintMarkdown));
        }
        if (problem.articleMarkdown) {
            const articleMarkdown: string = this.getPythonOnlyArticleMarkdown(problem.articleMarkdown);
            const articleHtml: string = markdownEngine.render(articleMarkdown).replace(
                /<p>(?:&lt;br&gt;|<br\s*\/?>)<\/p>/g,
                ""
            );
            sections.push([
                `<details>`,
                `<summary><strong>Article</strong></summary>`,
                articleHtml,
                `</details>`,
            ].join("\n"));
        }

        sections.push(`</div>`);

        return sections.join("\n");
    }

    private getTagLink(tag: string): string {
        const endPoint: string = getLeetCodeEndpoint();
        if (endPoint === Endpoint.LeetCodeCN) {
            return `https://leetcode.cn/tag/${tag}?source=vscode`;
        } else if (endPoint === Endpoint.LeetCode) {
            return `https://leetcode.com/tag/${tag}?source=vscode`;
        }

        return "https://leetcode.com?source=vscode";
    }

    private getSolutionsLink(url: string): string {
        return url.replace("/description/", "/solutions/") + "?source=vscode";
    }
    private getSubmissionsLink(url: string): string {
        return url.replace("/description/", "/submissions/") + "?source=vscode";
    }

    private getPythonOnlyArticleMarkdown(articleMarkdown: string): string {
        const output: string[] = [];
        const lines: string[] = articleMarkdown.split(/\r?\n/);
        let inTabs: boolean = false;
        let inPythonFence: boolean = false;
        let inSkippedFence: boolean = false;

        for (const line of lines) {
            const trimmed: string = line.trim();

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
                if (trimmed === "<br>" || trimmed === "<br/>" || trimmed === "<br />") {
                    continue;
                }

                output.push(line);
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

                const language: string = trimmed.slice(3).trim().toLowerCase();
                const isPythonFence: boolean = language === "python" || language === "python3" || language === "py" || language.startsWith("python ");

                if (isPythonFence) {
                    inPythonFence = true;
                    output.push(line);
                } else {
                    inSkippedFence = true;
                }

                continue;
            }

            if (inPythonFence) {
                output.push(line);
                continue;
            }

            if (trimmed === "<br>" || trimmed === "<br/>" || trimmed === "<br />") {
                continue;
            }
        }

        return output.join("\n");
    }

    private getExpandedHintMarkdown(hintMarkdown: string): string {
        return hintMarkdown.replace(
            /<details class="hint-accordion">/,
            '<details class="hint-accordion" open>'
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

interface IWebViewMessage {
    command: string;
    tag?: string;
    company?: string;
    sheet?: string;
}

export const leetCodePreviewProvider: LeetCodePreviewProvider = new LeetCodePreviewProvider();
