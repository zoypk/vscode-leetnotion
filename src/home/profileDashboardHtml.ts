import type { ActivityGraph, DashboardViewModel, ProgressRow, SubmissionSummary } from "./profileDashboardModel";

export type ProfileDashboardStatus = "empty" | "loading" | "ready" | "error";

export interface ProfileDashboardState {
    status: ProfileDashboardStatus;
    username?: string;
    message?: string;
    signedInUsername?: string;
    model?: DashboardViewModel;
}

export interface ProfileDashboardPageOptions {
    nonce: string;
    cspSource: string;
    scriptUri: string;
}

export type ProfileDashboardAction = "lookup" | "refresh" | "signin" | "useSignedInProfile";

const PROFILE_ACTIONS = new Set<ProfileDashboardAction>(["lookup", "refresh", "signin", "useSignedInProfile"]);

export function parseProfileDashboardAction(message: unknown): ProfileDashboardAction | undefined {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
        return undefined;
    }
    const record = message as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.action !== "string") {
        return undefined;
    }
    return PROFILE_ACTIONS.has(record.action as ProfileDashboardAction)
        ? record.action as ProfileDashboardAction
        : undefined;
}

export function renderProfileDashboardPage(
    state: ProfileDashboardState,
    options: ProfileDashboardPageOptions,
): string {
    const actions = renderActionButtons(state);
    const body = renderBody(state, actions);
    const nonce = escapeAttribute(options.nonce);
    const scriptUri = escapeAttribute(options.scriptUri);
    const cspSource = escapeAttribute(options.cspSource);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Leetnotion Home</title>
    <style nonce="${nonce}">
        :root { color-scheme: light dark; --heatmap-level-0: var(--vscode-editor-background); --heatmap-level-1: #0e4429; --heatmap-level-2: #006d32; --heatmap-level-3: #26a641; --heatmap-level-4: #39d353; }
        body.vscode-light, body.vscode-high-contrast-light { --heatmap-level-1: #9be9a8; --heatmap-level-2: #40c463; --heatmap-level-3: #30a14e; --heatmap-level-4: #216e39; }
        body.vscode-high-contrast, body.vscode-high-contrast-light { --heatmap-level-0: transparent; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); background: var(--vscode-sideBar-background); }
        a { color: var(--vscode-textLink-foreground); text-decoration: none; }
        a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
        a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
        .stack { display: grid; gap: 16px; }
        .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, transparent); border-radius: 10px; padding: 14px; }
        .empty-state { display: grid; gap: 12px; padding: 8px 0; }
        .header { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 12px; align-items: center; }
        .avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; background: var(--vscode-editor-background); }
        .title { margin: 0; font-size: 1.05rem; font-weight: 600; }
        .subtitle { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
        .summary { margin: 10px 0 0; color: var(--vscode-descriptionForeground); }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; }
        button { min-height: 32px; border: 1px solid transparent; border-radius: 6px; padding: 6px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
        button.secondary { color: var(--vscode-foreground); background: var(--vscode-input-background); border-color: var(--vscode-input-border, transparent); }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.secondary:hover { background: var(--vscode-list-hoverBackground); }
        .stats-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .stat { padding: 12px; border-radius: 8px; background: var(--vscode-editor-background); }
        .stat-label { margin: 0; color: var(--vscode-descriptionForeground); font-size: 0.82rem; }
        .stat-value { margin: 6px 0 0; font-size: 1.1rem; font-weight: 700; }
        .section-title { margin: 0 0 10px; font-size: 0.95rem; font-weight: 600; }
        .progress-row { display: grid; gap: 6px; }
        .progress-row + .progress-row { margin-top: 10px; }
        .progress-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        progress { width: 100%; height: 8px; accent-color: var(--vscode-button-background); }
        .muted { color: var(--vscode-descriptionForeground); }
        .heatmap { display: grid; gap: 8px; }
        .heatmap-grid { display: grid; grid-template-columns: repeat(18, minmax(0, 1fr)); gap: 4px; }
        .heatmap-week { display: grid; grid-template-rows: repeat(7, 9px); gap: 4px; }
        .heatmap-cell { width: 100%; height: 9px; border-radius: 2px; background: var(--heatmap-level-0); }
        .heatmap-cell.level-1 { background: var(--heatmap-level-1); }
        .heatmap-cell.level-2 { background: var(--heatmap-level-2); }
        .heatmap-cell.level-3 { background: var(--heatmap-level-3); }
        .heatmap-cell.level-4 { background: var(--heatmap-level-4); }
        .heatmap-legend { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--vscode-descriptionForeground); font-size: 0.8rem; }
        .heatmap-scale { display: flex; align-items: center; gap: 4px; }
        .heatmap-swatch { width: 10px; height: 10px; border-radius: 2px; background: var(--vscode-editor-background); }
        details { margin-top: 10px; }
        summary { cursor: pointer; }
        .activity-table-wrap { margin-top: 8px; max-height: 240px; overflow: auto; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 5px 4px; border-bottom: 1px solid var(--vscode-widget-border, transparent); text-align: left; }
        th:last-child, td:last-child { text-align: right; }
        .submission-list { display: grid; gap: 10px; }
        .submission-item { display: grid; gap: 4px; padding: 10px 0; border-top: 1px solid var(--vscode-widget-border, transparent); }
        .submission-item:first-child { border-top: none; padding-top: 0; }
        .submission-meta { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    </style>
</head>
<body>
    <div class="stack">${body}</div>
    <p id="refresh-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true">${refreshStatus(state)}</p>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function renderBody(state: ProfileDashboardState, actions: string): string {
    switch (state.status) {
        case "loading":
            return `<section class="empty-state"><h1 class="title">Loading profile</h1><p>Fetching public profile and contest data for <strong>${escapeHtml(state.username ?? "")}</strong>.</p></section>`;
        case "error":
            return `<section class="empty-state"><h1 class="title">Profile unavailable</h1><p>${escapeHtml(state.message ?? "Something went wrong while loading this profile.")}</p><div class="actions">${actions}</div></section>`;
        case "ready":
            return state.model ? renderDashboard(state.model, actions, state.signedInUsername) : renderMissingModel(actions);
        case "empty":
        default:
            return `<section class="empty-state"><h1 class="title">Home dashboard</h1><p>${escapeHtml(state.message ?? "Look up a public LeetCode profile to get started.")}</p><div class="actions">${actions}</div></section>`;
    }
}

function renderMissingModel(actions: string): string {
    return `<section class="empty-state"><h1 class="title">Profile unavailable</h1><p>The profile data could not be displayed.</p><div class="actions">${actions}</div></section>`;
}

function renderDashboard(model: DashboardViewModel, actions: string, signedInUsername?: string): string {
    const avatar = safeHttpsOrDataImage(model.avatar) ?? "https://static-00.iconduck.com/assets.00/user-avatar-icon-2048x2048-ilrgizwk.png";
    const switchBackButton = signedInUsername && signedInUsername !== model.username
        ? actionButton("useSignedInProfile", "Use signed-in profile", true)
        : "";
    return `
        <section class="card"><div class="header"><img class="avatar" src="${escapeAttribute(avatar)}" alt="${escapeAttribute(model.username)} avatar"><div><h1 class="title">${escapeHtml(model.displayName || model.username)}</h1><p class="subtitle">@${escapeHtml(model.username)}</p>${model.summaryText ? `<p class="summary">${escapeHtml(model.summaryText)}</p>` : ""}</div></div></section>
        <section class="card"><div class="actions">${actions}${switchBackButton}</div></section>
        <section class="card"><h2 class="section-title">Snapshot</h2><div class="stats-grid">${stat("Solved", model.solvedTotal)}${stat("Current streak", formatDays(model.activity.currentStreak))}${stat("Active days (30d)", formatNumber(model.activity.activeDays30))}${stat("Tracked active days", formatNumber(model.activity.totalActiveDays))}</div></section>
        <section class="card"><h2 class="section-title">Activity Graph</h2>${renderActivityGraph(model.activityGraph)}</section>
        <section class="card"><h2 class="section-title">Solved Breakdown</h2>${model.progressRows.map(renderProgressRow).join("")}</section>
        <section class="card"><h2 class="section-title">Contest Summary</h2>${renderContest(model)}</section>
        <section class="card"><h2 class="section-title">Recent Accepted</h2><div class="submission-list">${renderRecentAccepted(model.recentAccepted)}</div></section>`;
}

function renderActivityGraph(graph: ActivityGraph): string {
    const visualWeeks = graph.weeks.map((week) => `<div class="heatmap-week">${week.map((cell) => `<span class="heatmap-cell level-${cell.level}"></span>`).join("")}</div>`).join("");
    const rows = graph.weeks
        .reduce((cells, week) => cells.concat(week), [])
        .map((cell) => `<tr><td>${escapeHtml(cell.dateLabel)}</td><td>${formatNumber(cell.count)}</td></tr>`)
        .join("");
    return `<div class="heatmap">
        <div class="heatmap-grid" aria-hidden="true">${visualWeeks}</div>
        <div class="heatmap-legend"><span>${escapeHtml(graph.rangeLabel)}</span><div class="heatmap-scale" aria-hidden="true"><span>Less</span><span class="heatmap-swatch"></span><span class="heatmap-swatch heatmap-cell level-1"></span><span class="heatmap-swatch heatmap-cell level-2"></span><span class="heatmap-swatch heatmap-cell level-3"></span><span class="heatmap-swatch heatmap-cell level-4"></span><span>More</span></div></div>
        <details data-state-id="activity-table"><summary>Activity data by date</summary><div class="activity-table-wrap"><table><thead><tr><th scope="col">Date</th><th scope="col">Submissions</th></tr></thead><tbody>${rows}</tbody></table></div></details>
    </div>`;
}

function renderProgressRow(row: ProgressRow): string {
    const max = Math.max(1, row.total);
    const value = Math.min(max, Math.max(0, row.solved));
    return `<div class="progress-row"><div class="progress-label"><span>${escapeHtml(row.label)}</span><span class="muted">${escapeHtml(formatSolvedCount(row.solved, row.total))}</span></div><progress value="${value}" max="${max}" aria-label="${escapeAttribute(`${row.label}: ${formatSolvedCount(row.solved, row.total)} solved`)}"></progress></div>`;
}

function renderContest(model: DashboardViewModel): string {
    const contest = model.contest;
    if (!contest) {
        return `<p class="muted">No public contest ranking data was available for this user.</p>`;
    }
    return `<div class="stats-grid">${stat("Contest rating", contest.rating)}${stat("Global rank", contest.globalRanking)}${stat("Top percentage", contest.topPercentage)}${stat("Attended contests", contest.attendedContests)}</div>${contest.latestContest ? `<p class="muted">Latest attended contest: ${escapeHtml(contest.latestContest)}</p>` : ""}`;
}

function renderRecentAccepted(submissions: SubmissionSummary[]): string {
    const safeSubmissions = submissions.filter((submission) => isSafeHttpsUrl(submission.url));
    if (safeSubmissions.length === 0) {
        return `<p class="muted">No recent accepted submissions were found.</p>`;
    }
    return safeSubmissions.map((submission) => `<article class="submission-item"><a href="${escapeAttribute(submission.url)}">${escapeHtml(submission.title)}</a><div class="submission-meta">${escapeHtml(submission.relativeTime)} · ${escapeHtml(submission.lang)} · ${escapeHtml(submission.runtime)}</div></article>`).join("");
}

function renderActionButtons(state: ProfileDashboardState): string {
    const buttons = [actionButton("lookup", "Lookup profile"), actionButton("refresh", "Refresh", true)];
    if (!state.signedInUsername) {
        buttons.unshift(actionButton("signin", "Sign in", true));
    }
    return buttons.join("");
}

function actionButton(action: ProfileDashboardAction, label: string, secondary = false): string {
    return `<button type="button"${secondary ? ` class="secondary"` : ""} data-action="${action}">${escapeHtml(label)}</button>`;
}

function stat(label: string, value: string): string {
    return `<div class="stat"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

function refreshStatus(state: ProfileDashboardState): string {
    switch (state.status) {
        case "loading": return "Refreshing profile.";
        case "ready": return "Profile updated.";
        case "error": return "Profile refresh failed.";
        default: return "";
    }
}

function safeHttpsOrDataImage(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    if (/^data:image\/(?:png|gif|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(value)) {
        return value;
    }
    return isSafeHttpsUrl(value) ? value : undefined;
}

function isSafeHttpsUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && Boolean(url.hostname);
    } catch {
        return false;
    }
}

function formatSolvedCount(solved: number, total: number): string {
    return `${formatNumber(solved)} / ${formatNumber(total)}`;
}

function formatDays(days: number): string {
    return `${formatNumber(days)} day${days === 1 ? "" : "s"}`;
}

function formatNumber(value: number): string {
    return value.toLocaleString("en-US");
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
    return escapeHtml(value);
}
