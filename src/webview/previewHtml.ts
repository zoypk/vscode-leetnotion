import { createWebviewCsp, escapeAttribute, escapeHtml, sanitizeHtml } from "./webviewSecurity";

export interface PreviewActionItem {
    readonly id: string;
    readonly label: string;
}

export interface PreviewDisclosure {
    readonly items: readonly PreviewActionItem[];
    readonly title: string;
}

export interface NeetCodePreviewContent {
    readonly articleHtml?: string;
    readonly hintHtml?: string;
    readonly linksHtml?: string;
    readonly metadataHtml?: string;
}

export interface ProblemPreviewHtmlModel {
    readonly actionScriptUri: string;
    readonly cspSource: string;
    readonly descriptionHtml: string;
    readonly disclosures: readonly PreviewDisclosure[];
    readonly learningResourcesHtml?: string;
    readonly linkActions?: readonly PreviewActionItem[];
    readonly linksHtml: string;
    readonly neetCode?: NeetCodePreviewContent;
    readonly nonce: string;
    readonly overviewHtml: string;
    readonly solveActionId?: string;
    readonly stylesHtml: string;
}

export interface SolutionPreviewHtmlModel {
    readonly bodyHtml: string;
    readonly cspSource: string;
    readonly infoHtml: string;
    readonly nonce: string;
    readonly stylesHtml: string;
    readonly titleHtml: string;
}

export function renderProblemPreviewHtml(model: ProblemPreviewHtmlModel): string {
    const csp = createWebviewCsp(model.cspSource, model.nonce);
    const hasNeetCode = Boolean(model.neetCode);
    const quickNavItems = [
        quickNavLink("overview", "Overview"),
        quickNavLink("description", "Description"),
        model.learningResourcesHtml ? quickNavLink("learning-resources", "Learning resources") : "",
        hasNeetCode ? quickNavLink("neetcode", "NeetCode") : "",
        quickNavLink("links", "Links"),
    ].filter(Boolean).join("");
    const disclosures = model.disclosures
        .filter((section) => section.items.length > 0)
        .map(renderDisclosure)
        .join("\n");
    const solveButton = model.solveActionId
        ? `<button type="button" id="solve" data-action-id="${escapeAttribute(model.solveActionId)}">Code Now</button>`
        : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${model.stylesHtml}
    <style nonce="${escapeAttribute(model.nonce)}">${previewStyles()}</style>
</head>
<body>
    <section id="overview">${sanitizeHtml(model.overviewHtml)}</section>
    <nav class="quick-nav" aria-label="Quick navigation">${quickNavItems}</nav>
    ${disclosures}
    <section id="description" class="reading-column">
        <hr>
        ${sanitizeHtml(model.descriptionHtml)}
    </section>
    ${renderLearningResources(model.learningResourcesHtml)}
    ${renderNeetCode(model.neetCode)}
    <section id="links"><hr>${sanitizeHtml(model.linksHtml)}${renderLinkActions(model.linkActions)}</section>
    ${solveButton}
    <script nonce="${escapeAttribute(model.nonce)}" type="module" src="${escapeAttribute(model.actionScriptUri)}"></script>
</body>
</html>`;
}

function renderLinkActions(actions: readonly PreviewActionItem[] | undefined): string {
    if (!actions || actions.length === 0) {
        return "";
    }
    return `<p>${actions.map((item) =>
        `<button type="button" class="action-link" data-action-id="${escapeAttribute(item.id)}">${escapeHtml(item.label)}</button>`,
    ).join(" <span aria-hidden=\"true\">|</span> ")}</p>`;
}

export function renderSolutionPreviewHtml(model: SolutionPreviewHtmlModel): string {
    const csp = createWebviewCsp(model.cspSource, model.nonce);
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${model.stylesHtml}
    <style nonce="${escapeAttribute(model.nonce)}">${previewStyles()}</style>
</head>
<body style="tab-size:4">
    <section id="overview">${sanitizeHtml(model.titleHtml)}${sanitizeHtml(model.infoHtml)}</section>
    <main class="reading-column">${sanitizeHtml(model.bodyHtml)}</main>
</body>
</html>`;
}

function renderDisclosure(disclosure: PreviewDisclosure): string {
    const items = disclosure.items.map((item) =>
        `<button type="button" class="action-link" data-action-id="${escapeAttribute(item.id)}"><code>${escapeHtml(item.label)}</code></button>`,
    ).join(" <span aria-hidden=\"true\">|</span> ");
    const slug = disclosure.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `<section id="${escapeAttribute(slug)}"><details><summary><strong>${escapeHtml(disclosure.title)}</strong></summary>${items}</details></section>`;
}

function renderLearningResources(html: string | undefined): string {
    if (!html) {
        return "";
    }
    return `<section id="learning-resources" class="reading-column"><hr><details open><summary><strong>Learning resources</strong></summary>${sanitizeHtml(html)}</details></section>`;
}

function renderNeetCode(content: NeetCodePreviewContent | undefined): string {
    if (!content) {
        return "";
    }
    const metadata = content.metadataHtml ? `<div>${sanitizeHtml(content.metadataHtml)}</div>` : "";
    const links = content.linksHtml ? `<div>${sanitizeHtml(content.linksHtml)}</div>` : "";
    const hint = content.hintHtml
        ? `<div id="neetcode-hints" class="reading-column">${sanitizeHtml(content.hintHtml)}</div>`
        : "";
    const article = content.articleHtml
        ? `<details id="neetcode-article" class="reading-column"><summary><strong>Article</strong></summary>${sanitizeHtml(content.articleHtml)}</details>`
        : "";
    return `<section id="neetcode" class="reading-column"><hr><h2>NeetCode</h2>${metadata}${links}${hint}${article}</section>`;
}

function quickNavLink(fragment: string, label: string): string {
    return `<a href="#${escapeAttribute(fragment)}">${escapeHtml(label)}</a>`;
}

function previewStyles(): string {
    return `
html { scroll-behavior: smooth; }
section { scroll-margin-top: 4rem; }
.reading-column { width: min(100%, 68ch); margin-inline: auto; }
.reading-column h1, .reading-column h2, .reading-column h3,
.reading-column h4, .reading-column h5, .reading-column h6 { text-wrap: balance; }
.reading-column p, .reading-column li, .reading-column blockquote { text-wrap: pretty; }
.reading-column pre, .reading-column table { display: block; max-width: 100%; overflow-x: auto; }
.reading-column pre code { white-space: pre; }
.quick-nav { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; padding: .75rem 0; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); }
.quick-nav a { padding: .2rem .6rem; border-radius: 999px; text-decoration: none; color: var(--vscode-textLink-foreground); background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.16)); }
.quick-nav a:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.28)); }
.action-link { appearance: none; border: 0; padding: 0; color: var(--vscode-textLink-foreground); background: transparent; cursor: pointer; font: inherit; }
.action-link:hover { text-decoration: underline; }
#solve { position: fixed; right: 1rem; bottom: 1rem; border: 0; margin: 1rem 0; padding: .3rem 1rem; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
#solve:hover { background: var(--vscode-button-hoverBackground); }
#neetcode-hints details.hint-accordion { margin-bottom: 0; }
#neetcode-hints details.hint-accordion + details { margin-top: 0; }
`;
}
