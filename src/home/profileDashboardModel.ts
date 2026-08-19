export interface ProgressRow {
    label: string;
    solved: number;
    total: number;
    percent: number;
}

export interface ActivitySummary {
    currentStreak: number;
    activeDays30: number;
    totalActiveDays: number;
}

export interface ActivityCell {
    date: string;
    dateLabel: string;
    count: number;
    level: number;
}

export interface ActivityGraph {
    weeks: ActivityCell[][];
    maxCount: number;
    rangeLabel: string;
}

export interface ContestSummary {
    rating: string;
    globalRanking: string;
    topPercentage: string;
    attendedContests: string;
    latestContest?: string;
}

export interface SubmissionSummary {
    title: string;
    url: string;
    lang: string;
    runtime: string;
    relativeTime: string;
}

export interface RecentSubmissionInput {
    title: string;
    titleSlug?: string;
    timestamp: string;
    lang: string;
    runtime?: string;
}

export interface DashboardViewModel {
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

const DAY_MILLISECONDS = 86_400_000;
const DAY_SECONDS = 86_400;
const TITLE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
});

export function createProgressRow(label: string, solved: number, total: number): ProgressRow {
    const safeSolved = toNonNegativeInteger(solved);
    const safeTotal = toNonNegativeInteger(total);
    return {
        label,
        solved: safeSolved,
        total: safeTotal,
        percent: safeTotal > 0 ? Math.min(100, (safeSolved / safeTotal) * 100) : 0,
    };
}

export function summarizeActivity(calendar: string, now: Date = new Date()): ActivitySummary {
    const parsed = parseCalendar(calendar);
    const activeDays = new Set<number>();
    for (const [day, count] of parsed) {
        if (count > 0) {
            activeDays.add(day);
        }
    }

    const today = utcDayNumber(now);
    const streakStart = activeDays.has(today) ? today : activeDays.has(today - 1) ? today - 1 : undefined;
    let currentStreak = 0;
    if (streakStart !== undefined) {
        for (let day = streakStart; activeDays.has(day); day -= 1) {
            currentStreak += 1;
        }
    }

    let activeDays30 = 0;
    for (let day = today - 29; day <= today; day += 1) {
        if (activeDays.has(day)) {
            activeDays30 += 1;
        }
    }

    return { currentStreak, activeDays30, totalActiveDays: activeDays.size };
}

export function buildActivityGraph(calendar: string, now: Date = new Date()): ActivityGraph {
    const parsed = parseCalendar(calendar);
    const today = startOfUtcDay(now);
    const currentWeekSunday = addUtcDays(today, -today.getUTCDay());
    const graphStart = addUtcDays(currentWeekSunday, -17 * 7);
    const weeks: ActivityCell[][] = [];
    let maxCount = 0;

    for (let weekIndex = 0; weekIndex < 18; weekIndex += 1) {
        const weekStart = addUtcDays(graphStart, weekIndex * 7);
        const daysInWeek = weekIndex === 17 ? today.getUTCDay() + 1 : 7;
        const week: ActivityCell[] = [];
        for (let dayIndex = 0; dayIndex < daysInWeek; dayIndex += 1) {
            const date = addUtcDays(weekStart, dayIndex);
            const count = parsed.get(utcDayNumber(date)) ?? 0;
            maxCount = Math.max(maxCount, count);
            week.push({ date: toIsoDate(date), dateLabel: formatDate(date), count, level: 0 });
        }
        weeks.push(week);
    }

    for (const week of weeks) {
        for (const cell of week) {
            cell.level = toHeatLevel(cell.count, maxCount);
        }
    }

    const first = weeks[0]?.[0];
    const lastWeek = weeks[weeks.length - 1];
    const last = lastWeek?.[lastWeek.length - 1];
    return {
        weeks,
        maxCount,
        rangeLabel: first && last ? `${first.dateLabel} – ${last.dateLabel}` : "Recent activity",
    };
}

export function buildRecentSubmission(
    submission: RecentSubmissionInput,
    configuredBaseUrl: string,
    now: Date = new Date(),
): SubmissionSummary | undefined {
    const problemUrl = buildProblemUrl(configuredBaseUrl, submission.titleSlug);
    if (!problemUrl) {
        return undefined;
    }
    return {
        title: submission.title,
        url: problemUrl,
        lang: submission.lang,
        runtime: submission.runtime || "-",
        relativeTime: formatRelativeTime(submission.timestamp, now),
    };
}

export function buildProblemUrl(configuredBaseUrl: string, titleSlug: string | undefined): string | undefined {
    if (!titleSlug || !TITLE_SLUG_PATTERN.test(titleSlug)) {
        return undefined;
    }
    try {
        const base = new URL(configuredBaseUrl);
        if (base.protocol !== "https:") {
            return undefined;
        }
        return new URL(`/problems/${titleSlug}/`, base.origin).toString();
    } catch {
        return undefined;
    }
}

export function formatRelativeTime(timestamp: string, now: Date = new Date()): string {
    const unixTimestamp = Number(timestamp);
    if (!Number.isFinite(unixTimestamp)) {
        return "Recently";
    }
    const secondsAgo = Math.max(0, Math.floor(now.getTime() / 1000) - unixTimestamp);
    if (secondsAgo < 60) {
        return "Just now";
    }
    if (secondsAgo < 3600) {
        return `${Math.floor(secondsAgo / 60)}m ago`;
    }
    if (secondsAgo < DAY_SECONDS) {
        return `${Math.floor(secondsAgo / 3600)}h ago`;
    }
    if (secondsAgo < DAY_SECONDS * 7) {
        return `${Math.floor(secondsAgo / DAY_SECONDS)}d ago`;
    }
    return `${Math.floor(secondsAgo / (DAY_SECONDS * 7))}w ago`;
}

function parseCalendar(calendar: string): Map<number, number> {
    const normalized = new Map<number, number>();
    if (!calendar) {
        return normalized;
    }
    try {
        const parsed = JSON.parse(calendar) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return normalized;
        }
        for (const [timestamp, rawCount] of Object.entries(parsed)) {
            const unixTimestamp = Number(timestamp);
            const count = Number(rawCount);
            if (!Number.isFinite(unixTimestamp) || !Number.isFinite(count) || count < 0) {
                continue;
            }
            const day = Math.floor(unixTimestamp / DAY_SECONDS);
            normalized.set(day, (normalized.get(day) ?? 0) + Math.floor(count));
        }
    } catch {
        return normalized;
    }
    return normalized;
}

function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_MILLISECONDS);
}

function utcDayNumber(date: Date): number {
    return Math.floor(date.getTime() / DAY_MILLISECONDS);
}

function toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function formatDate(date: Date): string {
    return dateFormatter.format(date);
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

function toNonNegativeInteger(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
