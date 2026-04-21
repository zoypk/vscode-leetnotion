import * as vscode from "vscode";
import { type ContestInfo, type UserContestInfo, type UserProfile, type UserSubmission } from "@leetnotion/leetcode-api";
import { globalState } from "../globalState";
import { leetcodeClient } from "../leetCodeClient";
import { leetCodeManager } from "../leetCodeManager";
import { getUrl } from "../shared";

type ViewStatus = "empty" | "loading" | "ready" | "error";

interface DashboardState {
    status: ViewStatus;
    username?: string;
    message?: string;
    signedInUsername?: string;
    model?: DashboardViewModel;
}

interface DashboardViewModel {
    username: string;
    displayName?: string;
    avatar?: string;
    summaryText?: string;
    solvedTotal: string;
    progressRows: ProgressRow[];
    activity: ActivitySummary;
    activityGraph: ActivityGraph;
    contest?: ContestSummary;
    recentAccepted: SubmissionSummary[];
}

interface ProgressRow {
    label: string;
    solved: number;
    total: number;
    percent: number;
}

interface ActivitySummary {
    currentStreak: number;
    activeDays30: number;
    totalActiveDays: number;
}

interface ActivityGraph {
    weeks: ActivityCell[][];
    maxCount: number;
    rangeLabel: string;
}

interface ActivityCell {
    dateLabel: string;
    count: number;
    level: number;
}

interface ContestSummary {
    rating: string;
    globalRanking: string;
    topPercentage: string;
    attendedContests: string;
    latestContest?: string;
}

interface SubmissionSummary {
    title: string;
    url: string;
    lang: string;
    runtime: string;
    relativeTime: string;
}

class ProfileDashboardProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private view?: vscode.WebviewView;
    private selectedUsername?: string;
    private requestId: number = 0;
    private pendingRefresh: boolean = false;
    private readonly disposables: vscode.Disposable[] = [];
    private state: DashboardState = {
        status: "empty",
    };

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        this.view.webview.options = {
            enableScripts: true,
        };

        this.disposables.push(
            this.view.onDidChangeVisibility(() => {
                if (this.view?.visible && this.pendingRefresh) {
                    void this.refresh();
                }
            }),
            this.view.webview.onDidReceiveMessage(async (message: { command?: string }) => {
                switch (message.command) {
                    case "lookup":
                        await this.promptForUsername();
                        break;
                    case "refresh":
                        await this.refresh();
                        break;
                    case "signin":
                        await vscode.commands.executeCommand("leetnotion.signin");
                        break;
                    case "useSignedInProfile":
                        this.selectedUsername = undefined;
                        await this.refresh();
                        break;
                }
            })
        );

        this.render();
        void this.refresh();
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    public async promptForUsername(): Promise<void> {
        const signedInUsername = this.getSignedInUsername();
        const currentValue = this.selectedUsername ?? signedInUsername ?? "";
        const username = await vscode.window.showInputBox({
            prompt: "Enter a LeetCode username to open in the Home view",
            placeHolder: signedInUsername ?? "e.g. leetcode",
            value: currentValue,
            ignoreFocusOut: true,
            validateInput: (value: string): string | undefined => {
                return value.trim() ? undefined : "Username must not be empty.";
            },
        });

        if (!username) {
            return;
        }

        const trimmedUsername = username.trim();
        this.selectedUsername = trimmedUsername === signedInUsername ? undefined : trimmedUsername;
        await this.refresh();
    }

    public async refresh(): Promise<void> {
        if (!this.isViewVisible()) {
            this.pendingRefresh = true;
            return;
        }

        this.pendingRefresh = false;
        const signedInUsername = this.getSignedInUsername();
        const targetUsername = this.selectedUsername ?? signedInUsername;
        const activeRequestId = ++this.requestId;

        if (!targetUsername) {
            this.state = {
                status: "empty",
                signedInUsername,
                message: "Sign in to load your profile, or look up any public LeetCode username.",
            };
            this.render();
            return;
        }

        this.state = {
            status: "loading",
            username: targetUsername,
            signedInUsername,
        };
        this.render();

        try {
            const [profile, contestInfo] = await Promise.all([
                leetcodeClient.getUserProfile(targetUsername),
                leetcodeClient.getUserContestInfo(targetUsername).catch(() => undefined),
            ]);

            if (activeRequestId !== this.requestId) {
                return;
            }

            if (!profile.matchedUser) {
                throw new Error(`Could not find a public profile for \"${targetUsername}\".`);
            }

            const model = await this.buildViewModel(profile, contestInfo, targetUsername);
            if (activeRequestId !== this.requestId) {
                return;
            }

            this.state = {
                status: "ready",
                username: targetUsername,
                signedInUsername,
                model,
            };
        } catch (error) {
            if (activeRequestId !== this.requestId) {
                return;
            }

            const message = error instanceof Error ? error.message : String(error);
            this.state = {
                status: "error",
                username: targetUsername,
                signedInUsername,
                message,
            };
        }

        this.render();
    }

    private async buildViewModel(profile: UserProfile, contestInfo: UserContestInfo | undefined, username: string): Promise<DashboardViewModel> {
        const matchedUser = profile.matchedUser!;
        const solvedCounts = toDifficultyMap(matchedUser.submitStats.acSubmissionNum);
        const totalCounts = toDifficultyMap(profile.allQuestionsCount);

        let recentAccepted = (profile.recentSubmissionList ?? []).filter((submission: UserSubmission) => submission.statusDisplay === "Accepted");
        if (recentAccepted.length === 0) {
            recentAccepted = (await leetcodeClient.getRecentUserSubmissions(username, 10).catch(() => [])).filter((submission: UserSubmission) => submission.statusDisplay === "Accepted");
        }

        return {
            username: matchedUser.username,
            displayName: matchedUser.profile.realName,
            avatar: matchedUser.profile.userAvatar,
            summaryText: [
                matchedUser.profile.countryName,
                matchedUser.profile.ranking ? `Global rank #${formatNumber(matchedUser.profile.ranking)}` : undefined,
                matchedUser.profile.reputation ? `Reputation ${formatNumber(matchedUser.profile.reputation)}` : undefined,
            ].filter(Boolean).join(" · "),
            solvedTotal: formatSolvedCount(solvedCounts.all, totalCounts.all),
            progressRows: [
                createProgressRow("Easy", solvedCounts.easy, totalCounts.easy),
                createProgressRow("Medium", solvedCounts.medium, totalCounts.medium),
                createProgressRow("Hard", solvedCounts.hard, totalCounts.hard),
            ],
            activity: summarizeActivity(matchedUser.submissionCalendar),
            activityGraph: buildActivityGraph(matchedUser.submissionCalendar),
            contest: summarizeContest(contestInfo),
            recentAccepted: recentAccepted.slice(0, 5).map((submission: UserSubmission) => ({
                title: submission.title,
                url: resolveUrl(submission.url),
                lang: submission.lang,
                runtime: submission.runtime || "-",
                relativeTime: formatRelativeTime(submission.timestamp),
            })),
        };
    }

    private render(): void {
        if (!this.view) {
            return;
        }

        this.view.description = this.state.username ? `@${this.state.username}` : undefined;
        this.view.webview.html = this.getHtml();
    }

    private getHtml(): string {
        const actions = this.getActionButtons();
        const signedInUsername = this.state.signedInUsername;

        let body = "";
        switch (this.state.status) {
            case "loading":
                body = `
                    <section class="empty-state">
                        <h2>Loading profile</h2>
                        <p>Fetching public profile and contest data for <strong>${escapeHtml(this.state.username ?? "")}</strong>.</p>
                    </section>
                `;
                break;
            case "error":
                body = `
                    <section class="empty-state">
                        <h2>Profile unavailable</h2>
                        <p>${escapeHtml(this.state.message ?? "Something went wrong while loading this profile.")}</p>
                        <div class="actions">${actions}</div>
                    </section>
                `;
                break;
            case "ready":
                body = this.renderDashboard(this.state.model!, actions, signedInUsername);
                break;
            case "empty":
            default:
                body = `
                    <section class="empty-state">
                        <h2>Home dashboard</h2>
                        <p>${escapeHtml(this.state.message ?? "Look up a public LeetCode profile to get started.")}</p>
                        <div class="actions">${actions}</div>
                    </section>
                `;
                break;
        }

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Leetnotion Home</title>
                <style>
                    :root {
                        color-scheme: light dark;
                        --heatmap-level-0: var(--vscode-editor-background);
                        --heatmap-level-1: #0e4429;
                        --heatmap-level-2: #006d32;
                        --heatmap-level-3: #26a641;
                        --heatmap-level-4: #39d353;
                    }
                    body.vscode-light,
                    body.vscode-high-contrast-light {
                        --heatmap-level-1: #9be9a8;
                        --heatmap-level-2: #40c463;
                        --heatmap-level-3: #30a14e;
                        --heatmap-level-4: #216e39;
                    }
                    body.vscode-high-contrast,
                    body.vscode-high-contrast-light {
                        --heatmap-level-0: transparent;
                    }
                    * {
                        box-sizing: border-box;
                    }
                    body {
                        margin: 0;
                        padding: 16px;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        background: var(--vscode-sideBar-background);
                    }
                    a {
                        color: var(--vscode-textLink-foreground);
                        text-decoration: none;
                    }
                    a:hover {
                        color: var(--vscode-textLink-activeForeground);
                    }
                    .stack {
                        display: grid;
                        gap: 16px;
                    }
                    .card {
                        background: var(--vscode-editorWidget-background);
                        border: 1px solid var(--vscode-widget-border, transparent);
                        border-radius: 10px;
                        padding: 14px;
                    }
                    .empty-state {
                        display: grid;
                        gap: 12px;
                        padding: 8px 0;
                    }
                    .header {
                        display: grid;
                        grid-template-columns: 52px minmax(0, 1fr);
                        gap: 12px;
                        align-items: center;
                    }
                    .avatar {
                        width: 52px;
                        height: 52px;
                        border-radius: 50%;
                        object-fit: cover;
                        background: var(--vscode-editor-background);
                    }
                    .title {
                        margin: 0;
                        font-size: 1.05rem;
                        font-weight: 600;
                    }
                    .subtitle {
                        margin: 4px 0 0;
                        color: var(--vscode-descriptionForeground);
                    }
                    .summary {
                        margin: 10px 0 0;
                        color: var(--vscode-descriptionForeground);
                    }
                    .actions {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 8px;
                    }
                    button {
                        border: 1px solid transparent;
                        border-radius: 6px;
                        padding: 6px 10px;
                        color: var(--vscode-button-foreground);
                        background: var(--vscode-button-background);
                        cursor: pointer;
                    }
                    button.secondary {
                        color: var(--vscode-foreground);
                        background: var(--vscode-input-background);
                        border-color: var(--vscode-input-border, transparent);
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    button.secondary:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .stats-grid {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 10px;
                    }
                    .stat {
                        padding: 12px;
                        border-radius: 8px;
                        background: var(--vscode-editor-background);
                    }
                    .stat-label {
                        margin: 0;
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.82rem;
                    }
                    .stat-value {
                        margin: 6px 0 0;
                        font-size: 1.1rem;
                        font-weight: 700;
                    }
                    .section-title {
                        margin: 0 0 10px;
                        font-size: 0.95rem;
                        font-weight: 600;
                    }
                    .progress-row {
                        display: grid;
                        gap: 6px;
                    }
                    .progress-row + .progress-row {
                        margin-top: 10px;
                    }
                    .progress-label {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                    }
                    .progress-track {
                        overflow: hidden;
                        height: 8px;
                        border-radius: 999px;
                        background: var(--vscode-editor-background);
                    }
                    .progress-bar {
                        height: 100%;
                        border-radius: 999px;
                        background: linear-gradient(90deg, var(--vscode-button-background), var(--vscode-textLink-foreground));
                    }
                    .muted {
                        color: var(--vscode-descriptionForeground);
                    }
                    .heatmap {
                        display: grid;
                        gap: 8px;
                    }
                    .heatmap-grid {
                        display: grid;
                        grid-template-columns: repeat(18, minmax(0, 1fr));
                        gap: 4px;
                    }
                    .heatmap-week {
                        display: grid;
                        grid-template-rows: repeat(7, 9px);
                        gap: 4px;
                    }
                    .heatmap-cell {
                        width: 100%;
                        height: 9px;
                        border-radius: 2px;
                        background: var(--heatmap-level-0);
                    }
                    .heatmap-cell.level-1 {
                        background: var(--heatmap-level-1);
                    }
                    .heatmap-cell.level-2 {
                        background: var(--heatmap-level-2);
                    }
                    .heatmap-cell.level-3 {
                        background: var(--heatmap-level-3);
                    }
                    .heatmap-cell.level-4 {
                        background: var(--heatmap-level-4);
                    }
                    .heatmap-legend {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.8rem;
                    }
                    .heatmap-scale {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    }
                    .heatmap-swatch {
                        width: 10px;
                        height: 10px;
                        border-radius: 2px;
                        background: var(--vscode-editor-background);
                    }
                    .submission-list {
                        display: grid;
                        gap: 10px;
                    }
                    .submission-item {
                        display: grid;
                        gap: 4px;
                        padding: 10px 0;
                        border-top: 1px solid var(--vscode-widget-border, transparent);
                    }
                    .submission-item:first-child {
                        border-top: none;
                        padding-top: 0;
                    }
                    .submission-meta {
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.85rem;
                    }
                </style>
            </head>
            <body>
                <div class="stack">
                    ${body}
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    function post(command) {
                        vscode.postMessage({ command });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private renderDashboard(model: DashboardViewModel, actions: string, signedInUsername?: string): string {
        const recentAccepted = model.recentAccepted.length > 0
            ? model.recentAccepted.map((submission: SubmissionSummary) => `
                <article class="submission-item">
                    <a href="${escapeAttribute(submission.url)}" target="_blank" rel="noreferrer">${escapeHtml(submission.title)}</a>
                    <div class="submission-meta">${escapeHtml(submission.relativeTime)} · ${escapeHtml(submission.lang)} · ${escapeHtml(submission.runtime)}</div>
                </article>
            `).join("")
            : `<p class="muted">No recent accepted submissions were found.</p>`;

        const contest = model.contest
            ? `
                <div class="stats-grid">
                    <div class="stat">
                        <p class="stat-label">Contest rating</p>
                        <p class="stat-value">${escapeHtml(model.contest.rating)}</p>
                    </div>
                    <div class="stat">
                        <p class="stat-label">Global rank</p>
                        <p class="stat-value">${escapeHtml(model.contest.globalRanking)}</p>
                    </div>
                    <div class="stat">
                        <p class="stat-label">Top percentage</p>
                        <p class="stat-value">${escapeHtml(model.contest.topPercentage)}</p>
                    </div>
                    <div class="stat">
                        <p class="stat-label">Attended contests</p>
                        <p class="stat-value">${escapeHtml(model.contest.attendedContests)}</p>
                    </div>
                </div>
                ${model.contest.latestContest ? `<p class="muted">Latest attended contest: ${escapeHtml(model.contest.latestContest)}</p>` : ""}
            `
            : `<p class="muted">No public contest ranking data was available for this user.</p>`;

        const switchBackButton = signedInUsername && signedInUsername !== model.username
            ? `<button type="button" class="secondary" onclick="post('useSignedInProfile')">Use signed-in profile</button>`
            : "";
        const activityGraph = renderActivityGraph(model.activityGraph);

        return `
            <section class="card">
                <div class="header">
                    <img class="avatar" src="${escapeAttribute(model.avatar || "https://static-00.iconduck.com/assets.00/user-avatar-icon-2048x2048-ilrgizwk.png")}" alt="${escapeAttribute(model.username)} avatar" />
                    <div>
                        <h1 class="title">${escapeHtml(model.displayName || model.username)}</h1>
                        <p class="subtitle">@${escapeHtml(model.username)}</p>
                        ${model.summaryText ? `<p class="summary">${escapeHtml(model.summaryText)}</p>` : ""}
                    </div>
                </div>
            </section>

            <section class="card">
                <div class="actions">
                    ${actions}
                    ${switchBackButton}
                </div>
            </section>

            <section class="card">
                <h2 class="section-title">Snapshot</h2>
                <div class="stats-grid">
                    <div class="stat">
                        <p class="stat-label">Solved</p>
                        <p class="stat-value">${escapeHtml(model.solvedTotal)}</p>
                    </div>
                    <div class="stat">
                        <p class="stat-label">Current streak</p>
                        <p class="stat-value">${escapeHtml(formatDays(model.activity.currentStreak))}</p>
                    </div>
                    <div class="stat">
                        <p class="stat-label">Active days (30d)</p>
                        <p class="stat-value">${escapeHtml(formatNumber(model.activity.activeDays30))}</p>
                    </div>
                    <div class="stat">
                        <p class="stat-label">Tracked active days</p>
                        <p class="stat-value">${escapeHtml(formatNumber(model.activity.totalActiveDays))}</p>
                    </div>
                </div>
            </section>

            <section class="card">
                <h2 class="section-title">Activity Graph</h2>
                ${activityGraph}
            </section>

            <section class="card">
                <h2 class="section-title">Solved Breakdown</h2>
                ${model.progressRows.map((row: ProgressRow) => `
                    <div class="progress-row">
                        <div class="progress-label">
                            <span>${escapeHtml(row.label)}</span>
                            <span class="muted">${escapeHtml(formatSolvedCount(row.solved, row.total))}</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-bar" style="width: ${row.percent.toFixed(1)}%"></div>
                        </div>
                    </div>
                `).join("")}
            </section>

            <section class="card">
                <h2 class="section-title">Contest Summary</h2>
                ${contest}
            </section>

            <section class="card">
                <h2 class="section-title">Recent Accepted</h2>
                <div class="submission-list">
                    ${recentAccepted}
                </div>
            </section>
        `;
    }

    private getActionButtons(): string {
        const buttons: string[] = [
            `<button type="button" onclick="post('lookup')">Lookup profile</button>`,
            `<button type="button" class="secondary" onclick="post('refresh')">Refresh</button>`,
        ];

        if (!this.state.signedInUsername) {
            buttons.unshift(`<button type="button" class="secondary" onclick="post('signin')">Sign in</button>`);
        }

        return buttons.join("");
    }

    private getSignedInUsername(): string | undefined {
        return globalState.getUserStatus()?.username || leetCodeManager.getUser();
    }

    private isViewVisible(): boolean {
        return Boolean(this.view?.visible);
    }
}

function toDifficultyMap(items: { difficulty: string; count: number }[]): Record<string, number> {
    const result: Record<string, number> = {
        all: 0,
        easy: 0,
        medium: 0,
        hard: 0,
    };

    for (const item of items) {
        result[item.difficulty.toLowerCase()] = item.count;
    }

    return result;
}

function createProgressRow(label: string, solved: number, total: number): ProgressRow {
    return {
        label,
        solved,
        total,
        percent: total > 0 ? Math.min(100, (solved / total) * 100) : 0,
    };
}

function summarizeActivity(calendar: string): ActivitySummary {
    const parsed = parseCalendar(calendar);
    const dayKeys = Object.keys(parsed).map((key: string) => Number(key)).filter((key: number) => !Number.isNaN(key) && parsed[key] > 0);
    const activeDays = new Set(dayKeys.map((timestamp: number) => Math.floor(timestamp / 86400)));
    const today = Math.floor(Date.now() / 1000 / 86400);

    let currentStreak = 0;
    for (let day = today; activeDays.has(day); day -= 1) {
        currentStreak += 1;
    }

    let activeDays30 = 0;
    for (let day = today - 29; day <= today; day += 1) {
        if (activeDays.has(day)) {
            activeDays30 += 1;
        }
    }

    return {
        currentStreak,
        activeDays30,
        totalActiveDays: activeDays.size,
    };
}

function buildActivityGraph(calendar: string): ActivityGraph {
    const parsed = parseCalendar(calendar);
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(startOfToday);
    start.setDate(start.getDate() - 125);
    start.setDate(start.getDate() - start.getDay());

    const weeks: ActivityCell[][] = [];
    let cursor = new Date(start);
    let maxCount = 0;

    for (let weekIndex = 0; weekIndex < 18; weekIndex += 1) {
        const week: ActivityCell[] = [];
        for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
            const timestamp = Math.floor(cursor.getTime() / 1000);
            const count = parsed[String(timestamp)] ?? 0;
            maxCount = Math.max(maxCount, count);
            week.push({
                dateLabel: cursor.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
                count,
                level: 0,
            });
            cursor.setDate(cursor.getDate() + 1);
        }
        weeks.push(week);
    }

    for (const week of weeks) {
        for (const cell of week) {
            cell.level = toHeatLevel(cell.count, maxCount);
        }
    }

    const firstDate = weeks[0]?.[0]?.dateLabel ?? "";
    const lastDate = weeks[weeks.length - 1]?.[6]?.dateLabel ?? "";

    return {
        weeks,
        maxCount,
        rangeLabel: firstDate && lastDate ? `${firstDate} - ${lastDate}` : "Recent activity",
    };
}

function renderActivityGraph(graph: ActivityGraph): string {
    const weeks = graph.weeks.map((week: ActivityCell[]) => `
        <div class="heatmap-week">
            ${week.map((cell: ActivityCell) => `
                <div class="heatmap-cell level-${cell.level}" title="${escapeAttribute(`${cell.dateLabel}: ${formatNumber(cell.count)} submissions`)}"></div>
            `).join("")}
        </div>
    `).join("");

    return `
        <div class="heatmap">
            <div class="heatmap-grid">${weeks}</div>
            <div class="heatmap-legend">
                <span>${escapeHtml(graph.rangeLabel)}</span>
                <div class="heatmap-scale">
                    <span>Less</span>
                    <span class="heatmap-swatch"></span>
                    <span class="heatmap-swatch heatmap-cell level-1"></span>
                    <span class="heatmap-swatch heatmap-cell level-2"></span>
                    <span class="heatmap-swatch heatmap-cell level-3"></span>
                    <span class="heatmap-swatch heatmap-cell level-4"></span>
                    <span>More</span>
                </div>
            </div>
        </div>
    `;
}

function toHeatLevel(count: number, maxCount: number): number {
    if (count <= 0 || maxCount <= 0) {
        return 0;
    }

    const ratio = count / maxCount;
    if (ratio >= 0.75) {
        return 4;
    }
    if (ratio >= 0.5) {
        return 3;
    }
    if (ratio >= 0.25) {
        return 2;
    }
    return 1;
}

function summarizeContest(contestInfo: UserContestInfo | undefined): ContestSummary | undefined {
    const ranking = contestInfo?.userContestRanking;
    if (!ranking) {
        return undefined;
    }

    const history = (contestInfo?.userContestRankingHistory ?? []).filter((contest: ContestInfo) => contest.attended);
    const latestContest = history.length > 0 ? history[history.length - 1] : undefined;

    return {
        rating: Number.isFinite(ranking.rating) ? formatNumber(Math.round(ranking.rating)) : "-",
        globalRanking: Number.isFinite(ranking.globalRanking) ? `#${formatNumber(ranking.globalRanking)}` : "-",
        topPercentage: Number.isFinite(ranking.topPercentage) ? `${ranking.topPercentage.toFixed(2)}%` : "-",
        attendedContests: formatNumber(ranking.attendedContestsCount || 0),
        latestContest: latestContest ? `${latestContest.contest.title} · rank #${formatNumber(latestContest.ranking)}` : undefined,
    };
}

function parseCalendar(calendar: string): Record<string, number> {
    if (!calendar) {
        return {};
    }

    try {
        return JSON.parse(calendar) as Record<string, number>;
    } catch {
        return {};
    }
}

function resolveUrl(url: string): string {
    if (!url) {
        return getUrl("base");
    }

    if (/^https?:\/\//.test(url)) {
        return url;
    }

    return `${getUrl("base")}${url.startsWith("/") ? "" : "/"}${url}`;
}

function formatRelativeTime(timestamp: string): string {
    const unixTimestamp = Number(timestamp);
    if (Number.isNaN(unixTimestamp)) {
        return "Recently";
    }

    const secondsAgo = Math.max(0, Math.floor(Date.now() / 1000) - unixTimestamp);
    if (secondsAgo < 60) {
        return "Just now";
    }
    if (secondsAgo < 3600) {
        return `${Math.floor(secondsAgo / 60)}m ago`;
    }
    if (secondsAgo < 86400) {
        return `${Math.floor(secondsAgo / 3600)}h ago`;
    }
    if (secondsAgo < 604800) {
        return `${Math.floor(secondsAgo / 86400)}d ago`;
    }

    return `${Math.floor(secondsAgo / 604800)}w ago`;
}

function formatSolvedCount(solved: number, total: number): string {
    return `${formatNumber(solved)} / ${formatNumber(total)}`;
}

function formatDays(days: number): string {
    return `${formatNumber(days)} day${days === 1 ? "" : "s"}`;
}

function formatNumber(value: number): string {
    return value.toLocaleString();
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
    return escapeHtml(value);
}

export const profileDashboardProvider: ProfileDashboardProvider = new ProfileDashboardProvider();
