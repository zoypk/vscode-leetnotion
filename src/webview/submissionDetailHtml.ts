import { SubmissionDetailView, SubmissionHistoryItem } from "../types";

export type SubmissionDetailAction = "back" | "open-external";

export interface SubmissionDetailMessage {
    action: SubmissionDetailAction;
    submissionId: number;
}

export interface SubmissionDetailHtmlOptions {
    nonce: string;
    problemTitle: string;
    questionNumber: string;
    submission: SubmissionHistoryItem;
    detail: SubmissionDetailView;
}

export function parseSubmissionDetailMessage(value: unknown): SubmissionDetailMessage | undefined {
    if (!isExactObject(value, ["action", "submissionId"])) {
        return undefined;
    }

    const action = value.action;
    const submissionId = value.submissionId;
    if ((action !== "back" && action !== "open-external") || !isSubmissionId(submissionId)) {
        return undefined;
    }

    return { action, submissionId };
}

export function resolveSubmissionDetailMessage(
    value: unknown,
    activeSubmissionId: number
): SubmissionDetailMessage | undefined {
    const message = parseSubmissionDetailMessage(value);
    return message && message.submissionId === activeSubmissionId ? message : undefined;
}

export function renderSubmissionDetailHtml(options: SubmissionDetailHtmlOptions): string {
    const nonce = escapeHtml(options.nonce);
    const submissionId = escapeHtml(String(options.submission.id));
    const codeBlock = options.detail.code
        ? `<pre class="code-block"><code>${escapeHtml(options.detail.code)}</code></pre>`
        : `<div class="empty-state">Code is not available from LeetCode's current submission detail API. Use <strong>Open on LeetCode</strong> for the original page.</div>`;
    const extraSections = [
        renderTextSection("Last testcase", options.detail.details.testcase),
        renderTextSection("Stdout", options.detail.details.stdout),
        renderErrorSection(options.detail.details.error),
    ].filter(Boolean).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
        main { max-width: 76rem; margin-inline: auto; }
        h1 { font-size: 22px; margin: 0 0 6px; }
        h2 { font-size: 17px; margin: 20px 0 8px; }
        .subtitle { color: var(--vscode-descriptionForeground); margin-top: 6px; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
        button { border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
        table { border-collapse: collapse; width: 100%; max-width: 64rem; }
        th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 8px; text-align: left; overflow-wrap: anywhere; }
        th { color: var(--vscode-descriptionForeground); font-weight: 500; width: 12rem; }
        .code-block { margin: 16px 0 0; padding: 16px; overflow: auto; border-radius: 8px; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); font-family: var(--vscode-editor-font-family, monospace); white-space: pre-wrap; word-break: break-word; }
        .empty-state { margin-top: 16px; padding: 16px; border-radius: 8px; border: 1px dashed var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
    </style>
</head>
<body>
    <main>
        <h1>${escapeHtml(options.problemTitle)}</h1>
        <div class="subtitle">Problem ${escapeHtml(options.questionNumber)} &middot; Submission ${submissionId} &middot; ${escapeHtml(options.submission.status_display)}</div>
        <div class="actions">
            <button type="button" data-action="back" data-submission-id="${submissionId}">Back to submissions</button>
            <button type="button" data-action="open-external" data-submission-id="${submissionId}">Open on LeetCode</button>
        </div>
        ${renderInfoTable(options)}
        ${codeBlock}
        ${extraSections}
    </main>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target.closest('button[data-action][data-submission-id]') : null;
            if (!target) return;
            const submissionId = Number(target.getAttribute('data-submission-id'));
            const action = target.getAttribute('data-action');
            if (!Number.isSafeInteger(submissionId) || submissionId <= 0) return;
            if (action !== 'back' && action !== 'open-external') return;
            vscode.postMessage({ action, submissionId });
        });
    </script>
</body>
</html>`;
}

function renderInfoTable(options: SubmissionDetailHtmlOptions): string {
    const rows: [string, string | number][] = [
        ["Language", options.submission.lang],
        ["Runtime", options.submission.runtime || "N/A"],
        ["Memory", options.submission.memory || "N/A"],
        ["Runtime percentile", formatPercentile(options.detail.runtime_percentile)],
        ["Memory percentile", formatPercentile(options.detail.memory_percentile)],
        ["Total correct", options.detail.details.total_correct ?? "N/A"],
        ["Total testcases", options.detail.details.total_testcases ?? "N/A"],
        ["Result", options.detail.details.compare_result || options.detail.details.status_msg || "N/A"],
    ];
    return `<table><tbody>${rows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`).join("")}</tbody></table>`;
}

function renderTextSection(title: string, value?: string): string {
    return value ? `<h2>${escapeHtml(title)}</h2><pre class="code-block"><code>${escapeHtml(value)}</code></pre>` : "";
}

function renderErrorSection(errors?: string[]): string {
    return errors && errors.length > 0
        ? `<h2>Errors</h2><pre class="code-block"><code>${escapeHtml(errors.join("\n\n"))}</code></pre>`
        : "";
}

function formatPercentile(value: number | null): string {
    return typeof value === "number" ? value.toFixed(2) : "N/A";
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isSubmissionId(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
