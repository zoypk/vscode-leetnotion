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

export async function collectSubmissionHistory<T extends SubmissionHistoryPageItem>(
    fetchPage: SubmissionHistoryPageFetcher<T>,
    options: SubmissionHistoryOptions = {}
): Promise<T[]> {
    const pageSize = toPositiveInteger(options.pageSize, 20);
    const cap = toPositiveInteger(options.cap, 100);
    const submissions = new Map<number, T>();

    for (let offset = 0; submissions.size < cap; offset += pageSize) {
        const page = await fetchPage(offset, Math.min(pageSize, cap - submissions.size));
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

function toPositiveInteger(value: number | undefined, fallback: number): number {
    return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback;
}
