import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { type ContestInfo, type UserContestInfo, type UserProfile, type UserSubmission } from "@leetnotion/leetcode-api";
import { globalState } from "../globalState";
import { leetcodeClient } from "../leetCodeClient";
import { leetCodeManager } from "../leetCodeManager";
import { getUrl } from "../shared";
import {
    parseProfileDashboardAction,
    renderProfileDashboardPage,
    type ProfileDashboardState,
} from "./profileDashboardHtml";
import {
    buildActivityGraph,
    buildRecentSubmission,
    createProgressRow,
    summarizeActivity,
    type ContestSummary,
    type DashboardViewModel,
} from "./profileDashboardModel";

class ProfileDashboardProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private view?: vscode.WebviewView;
    private selectedUsername?: string;
    private requestId = 0;
    private pendingRefresh = false;
    private readonly disposables: vscode.Disposable[] = [];
    private state: ProfileDashboardState = { status: "empty" };

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.disposeViewListeners();
        this.view = webviewView;
        const publicRoot = vscode.Uri.joinPath(globalState.getExtensionUri(), "public");
        this.view.webview.options = {
            enableScripts: true,
            localResourceRoots: [publicRoot],
        };

        this.disposables.push(
            this.view.onDidChangeVisibility(() => {
                if (this.view?.visible && this.pendingRefresh) {
                    void this.refresh();
                }
            }),
            this.view.webview.onDidReceiveMessage(async (message: unknown) => {
                const action = parseProfileDashboardAction(message);
                switch (action) {
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
            }),
        );

        this.render();
        void this.refresh();
    }

    public dispose(): void {
        this.disposeViewListeners();
        this.view = undefined;
    }

    public async promptForUsername(): Promise<void> {
        const signedInUsername = this.getSignedInUsername();
        const currentValue = this.selectedUsername ?? signedInUsername ?? "";
        const username = await vscode.window.showInputBox({
            prompt: "Enter a LeetCode username to open in the Home view",
            placeHolder: signedInUsername ?? "e.g. leetcode",
            value: currentValue,
            ignoreFocusOut: true,
            validateInput: (value: string): string | undefined => value.trim() ? undefined : "Username must not be empty.",
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

        this.state = { status: "loading", username: targetUsername, signedInUsername };
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
                throw new Error(`Could not find a public profile for "${targetUsername}".`);
            }

            const model = await this.buildViewModel(profile, contestInfo, targetUsername);
            if (activeRequestId !== this.requestId) {
                return;
            }
            this.state = { status: "ready", username: targetUsername, signedInUsername, model };
        } catch (error) {
            if (activeRequestId !== this.requestId) {
                return;
            }
            this.state = {
                status: "error",
                username: targetUsername,
                signedInUsername,
                message: error instanceof Error ? error.message : String(error),
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
            recentAccepted = (await leetcodeClient.getRecentUserSubmissions(username, 10).catch(() => []))
                .filter((submission: UserSubmission) => submission.statusDisplay === "Accepted");
        }
        const now = new Date();
        const baseUrl = getUrl("base");

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
            activity: summarizeActivity(matchedUser.submissionCalendar, now),
            activityGraph: buildActivityGraph(matchedUser.submissionCalendar, now),
            contest: summarizeContest(contestInfo),
            recentAccepted: recentAccepted
                .map((submission: UserSubmission) => buildRecentSubmission(submission, baseUrl, now))
                .filter((submission): submission is NonNullable<typeof submission> => Boolean(submission))
                .slice(0, 5),
        };
    }

    private render(): void {
        if (!this.view) {
            return;
        }
        this.view.description = this.state.username ? `@${this.state.username}` : undefined;
        const nonce = randomBytes(16).toString("hex");
        const scriptUri = this.view.webview.asWebviewUri(vscode.Uri.joinPath(
            globalState.getExtensionUri(),
            "public",
            "scripts",
            "profile-dashboard.js",
        ));
        this.view.webview.html = renderProfileDashboardPage(this.state, {
            nonce,
            cspSource: this.view.webview.cspSource,
            scriptUri: scriptUri.toString(),
        });
    }

    private getSignedInUsername(): string | undefined {
        return globalState.getUserStatus()?.username || leetCodeManager.getUser();
    }

    private isViewVisible(): boolean {
        return Boolean(this.view?.visible);
    }

    private disposeViewListeners(): void {
        for (const disposable of this.disposables.splice(0)) {
            disposable.dispose();
        }
    }
}

function toDifficultyMap(items: { difficulty: string; count: number }[]): Record<string, number> {
    const result: Record<string, number> = { all: 0, easy: 0, medium: 0, hard: 0 };
    for (const item of items) {
        result[item.difficulty.toLowerCase()] = item.count;
    }
    return result;
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

function formatSolvedCount(solved: number, total: number): string {
    return `${formatNumber(solved)} / ${formatNumber(total)}`;
}

function formatNumber(value: number): string {
    return value.toLocaleString("en-US");
}

export const profileDashboardProvider: ProfileDashboardProvider = new ProfileDashboardProvider();
