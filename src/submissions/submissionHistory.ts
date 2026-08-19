export interface SubmissionHistoryPageItem {
    id: number;
    timestamp: number;
}

export type SubmissionHistoryPageFetcher<T extends SubmissionHistoryPageItem> = (
    offset: number,
    limit: number
) => Promise<readonly T[]>;

export interface SubmissionHistoryOptions {
    pageSize?: number;
    cap?: number;
}

export class SubmissionDetailRequestGuard {
    private generation = 0;

    public begin(): number {
        this.generation += 1;
        return this.generation;
    }

    public isCurrent(requestGeneration: number): boolean {
        return requestGeneration === this.generation;
    }
}

export async function collectSubmissionHistory<T extends SubmissionHistoryPageItem>(
    fetchPage: SubmissionHistoryPageFetcher<T>,
    options: SubmissionHistoryOptions = {}
): Promise<T[]> {
    const pageSize = toPositiveInteger(options.pageSize, 20);
    const cap = toPositiveInteger(options.cap, 100);
    const submissions = new Map<number, T>();

    for (let offset = 0; submissions.size < cap; offset += pageSize) {
        const page = await fetchPage(offset, pageSize);
        let added = 0;

        for (const submission of page) {
            if (!Number.isSafeInteger(submission.id) || submission.id <= 0 || submissions.has(submission.id)) {
                continue;
            }

            submissions.set(submission.id, submission);
            added += 1;
            if (submissions.size === cap) {
                break;
            }
        }

        if (page.length < pageSize || added === 0) {
            break;
        }
    }

    return Array.from(submissions.values())
        .sort((left, right) => right.timestamp - left.timestamp || right.id - left.id)
        .slice(0, cap);
}

export function resolveLeetCodeUrl(value: unknown, configuredBaseUrl: string): string | undefined {
    if (typeof value !== "string" || !value.trim()) {
        return undefined;
    }
    try {
        const baseUrl = new URL(configuredBaseUrl);
        const url = new URL(value.trim(), baseUrl);
        if (baseUrl.protocol !== "https:" || url.protocol !== "https:") {
            return undefined;
        }
        if (url.origin !== baseUrl.origin || url.username || url.password) {
            return undefined;
        }
        return url.toString();
    } catch {
        return undefined;
    }
}

export function keepTrustedSubmissionUrls<T extends { url: string }>(
    submissions: readonly T[],
    configuredBaseUrl: string
): T[] {
    const trusted: T[] = [];
    for (const submission of submissions) {
        const url = resolveLeetCodeUrl(submission.url, configuredBaseUrl);
        if (url) {
            trusted.push({ ...submission, url });
        }
    }
    return trusted;
}

export async function returnToSubmissionHistory(
    revealExisting: () => boolean,
    reload: () => Promise<void>
): Promise<"revealed" | "reloaded"> {
    if (revealExisting()) {
        return "revealed";
    }
    await reload();
    return "reloaded";
}

function toPositiveInteger(value: number | undefined, fallback: number): number {
    return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback;
}
