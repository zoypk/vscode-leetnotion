import { LeetcodeSubmission } from "../types";

export type SubmissionHistoryAction = "open-detail" | "open-external";

export interface SubmissionHistoryMessage {
    action: SubmissionHistoryAction;
    submissionId: number;
}

export interface ResolvedSubmissionHistoryMessage<T> extends SubmissionHistoryMessage {
    submission: T;
}

export interface SubmissionHistoryHtmlOptions {
    nonce: string;
    problemTitle: string;
    questionNumber: string;
    submissions: readonly LeetcodeSubmission[];
}

export function parseSubmissionHistoryMessage(value: unknown): SubmissionHistoryMessage | undefined {
    if (!isExactObject(value, ["action", "submissionId"])) {
        return undefined;
    }

    const action = value.action;
    const submissionId = value.submissionId;
    if ((action !== "open-detail" && action !== "open-external") || !isSubmissionId(submissionId)) {
        return undefined;
    }

    return { action, submissionId };
}

export function resolveSubmissionHistoryMessage<T>(
    value: unknown,
    submissionsById: ReadonlyMap<number, T>
): ResolvedSubmissionHistoryMessage<T> | undefined {
    const message = parseSubmissionHistoryMessage(value);
    if (!message) {
        return undefined;
    }

    const submission = submissionsById.get(message.submissionId);
    return submission ? { ...message, submission } : undefined;
}

export function renderSubmissionHistoryHtml(options: SubmissionHistoryHtmlOptions): string {
    const nonce = escapeHtml(options.nonce);
    const items = options.submissions.length > 0
        ? options.submissions.map(renderSubmission).join("\n")
        : `<div class="empty-state" role="status">No past submissions found for problem ${escapeHtml(options.questionNumber)}.</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
        main { max-width: 76rem; margin-inline: auto; }
        h1 { font-size: 20px; margin: 0 0 6px; }
        .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
        .submission { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px; margin-bottom: 12px; background: var(--vscode-sideBar-background); }
        .submission-header { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
        .status { font-weight: 600; }
        .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 12px; font-size: 13px; }
        .meta-label { color: var(--vscode-descriptionForeground); }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; }
        button { border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
        .empty-state { border: 1px dashed var(--vscode-panel-border); border-radius: 8px; padding: 16px; color: var(--vscode-descriptionForeground); }
    </style>
</head>
<body>
    <main>
        <h1>${escapeHtml(options.problemTitle)}</h1>
        <div class="subtitle">${options.submissions.length} submission${options.submissions.length === 1 ? "" : "s"} found for problem ${escapeHtml(options.questionNumber)}</div>
        ${items}
    </main>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target.closest('button[data-action][data-submission-id]') : null;
            if (!target) return;
            const submissionId = Number(target.getAttribute('data-submission-id'));
            const action = target.getAttribute('data-action');
            if (!Number.isSafeInteger(submissionId) || submissionId <= 0) return;
            if (action !== 'open-detail' && action !== 'open-external') return;
            vscode.postMessage({ action, submissionId });
        });
    </script>
</body>
</html>`;
}

function renderSubmission(submission: LeetcodeSubmission): string {
    const submissionId = escapeHtml(String(submission.id));
    return `<section class="submission">
        <div class="submission-header">
            <div>
                <div class="status">${escapeHtml(submission.status_display)}</div>
                <time datetime="${escapeHtml(new Date(submission.timestamp * 1000).toISOString())}">${escapeHtml(formatTimestamp(submission.timestamp))}</time>
            </div>
            <div class="actions">
                <button type="button" data-action="open-detail" data-submission-id="${submissionId}">View details</button>
                <button type="button" data-action="open-external" data-submission-id="${submissionId}">Open on LeetCode</button>
            </div>
        </div>
        <div class="meta">
            <div><span class="meta-label">Submission ID:</span> ${submissionId}</div>
            <div><span class="meta-label">Language:</span> ${escapeHtml(submission.lang)}</div>
            <div><span class="meta-label">Runtime:</span> ${escapeHtml(submission.runtime || "N/A")}</div>
            <div><span class="meta-label">Memory:</span> ${escapeHtml(submission.memory || "N/A")}</div>
        </div>
    </section>`;
}

function formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
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
