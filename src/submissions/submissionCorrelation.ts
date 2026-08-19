import { promises as fs } from "fs";
import type { LeetcodeSubmission, SubmissionDetailView } from "../types";
import { getQuestionNumber, sleep } from "../utils/toolUtils";
import type { SubmissionCorrelationRequest, SubmissionSource, ValidatedSubmission } from "./types";

export interface SubmissionCorrelationDependencies {
    listProblemSubmissions: (signal?: AbortSignal) => Promise<LeetcodeSubmission[]>;
    getSubmissionDetail: (submissionId: number, signal?: AbortSignal) => Promise<SubmissionDetailView>;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<unknown>;
}

export function normalizeSubmissionCode(code: string): string {
    return code
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n");
}

export function extractSubmissionSource(filePath: string, fileContent: string): SubmissionSource {
    const questionNumber = getQuestionNumber(filePath, fileContent);
    if (!questionNumber) {
        throw new Error(`submission-source-id-not-found:${filePath}`);
    }

    const codeStart = fileContent.indexOf("@lc code=start");
    const codeEnd = fileContent.indexOf("@lc code=end", codeStart + 1);
    if (codeStart < 0 || codeEnd < 0 || codeEnd <= codeStart) {
        throw new Error(`submission-source-code-markers-not-found:${filePath}`);
    }

    const contentStart = fileContent.indexOf("\n", codeStart);
    if (contentStart < 0 || contentStart >= codeEnd) {
        throw new Error(`submission-source-code-empty:${filePath}`);
    }
    const codeEndLineStart = fileContent.lastIndexOf("\n", codeEnd) + 1;
    let contentEnd = codeEndLineStart;
    if (contentEnd > contentStart && fileContent[contentEnd - 1] === "\n") {
        contentEnd -= 1;
        if (contentEnd > contentStart && fileContent[contentEnd - 1] === "\r") {
            contentEnd -= 1;
        }
    }

    return {
        questionNumber,
        code: normalizeSubmissionCode(fileContent.slice(contentStart + 1, contentEnd)),
    };
}

export async function readSubmissionSource(filePath: string): Promise<SubmissionSource> {
    return extractSubmissionSource(filePath, await fs.readFile(filePath, "utf8"));
}

function isTerminalStatus(status: string | undefined): status is string {
    if (!status || !status.trim()) {
        return false;
    }
    return !["pending", "started", "judging"].includes(status.trim().toLowerCase());
}

async function callBeforeDeadline<T>(
    label: string,
    deadline: number,
    now: () => number,
    operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
        throw new Error(`${label}-deadline-exceeded`);
    }

    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const deadlinePromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
            controller.abort();
            reject(new Error(`${label}-deadline-exceeded`));
        }, remainingMs);
    });

    try {
        return await Promise.race([operation(controller.signal), deadlinePromise]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

export async function correlateSubmission(
    request: SubmissionCorrelationRequest,
    dependencies: SubmissionCorrelationDependencies,
): Promise<ValidatedSubmission> {
    const timeoutMs = request.timeoutMs ?? 15_000;
    const pollIntervalMs = request.pollIntervalMs ?? 750;
    const clockSkewMs = request.clockSkewMs ?? 2_000;
    const now = dependencies.now ?? Date.now;
    const wait = dependencies.sleep ?? sleep;
    const deadline = now() + timeoutMs;
    const baselineIds = new Set(request.submissionIds);
    const expectedCode = normalizeSubmissionCode(request.submittedCode);
    const rejectedReasons = new Set<string>();

    do {
        let submissions: LeetcodeSubmission[] = [];
        try {
            submissions = await callBeforeDeadline(
                "submission-list",
                deadline,
                now,
                (signal) => dependencies.listProblemSubmissions(signal),
            );
        } catch (error) {
            rejectedReasons.add(`poll-error=${error instanceof Error ? error.message : String(error)}`);
        }
        const candidates = submissions
            .filter((submission) => !baselineIds.has(submission.id))
            .sort((left, right) => right.timestamp - left.timestamp);

        for (const candidate of candidates) {
            if (candidate.title_slug !== request.expectedSlug) {
                rejectedReasons.add(`${candidate.id}:slug=${candidate.title_slug}`);
                continue;
            }
            if ((candidate.timestamp * 1000) < (request.startedAtMs - clockSkewMs)) {
                rejectedReasons.add(`${candidate.id}:stale`);
                continue;
            }

            let detail: SubmissionDetailView;
            try {
                detail = await callBeforeDeadline(
                    `submission-detail:${candidate.id}`,
                    deadline,
                    now,
                    (signal) => dependencies.getSubmissionDetail(candidate.id, signal),
                );
            } catch (error) {
                rejectedReasons.add(`${candidate.id}:detail-unavailable`);
                continue;
            }
            if (normalizeSubmissionCode(detail.code) !== expectedCode) {
                rejectedReasons.add(`${candidate.id}:code-mismatch`);
                continue;
            }
            const authoritativeStatus = detail.details.status_msg ?? detail.details.compare_result;
            if (!isTerminalStatus(authoritativeStatus)) {
                rejectedReasons.add(`${candidate.id}:detail-pending`);
                continue;
            }

            return {
                questionNumber: request.questionNumber,
                submission: {
                    ...candidate,
                    code: detail.code,
                    compare_result: authoritativeStatus,
                    status_display: authoritativeStatus,
                },
                detail,
            };
        }

        if (now() < deadline) {
            await wait(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
        }
    } while (now() < deadline);

    const diagnostics = rejectedReasons.size > 0
        ? ` Rejected candidates: ${Array.from(rejectedReasons).join(", ")}.`
        : " No new candidates appeared.";
    throw new Error(`submission-correlation-timeout:${request.expectedSlug}.${diagnostics}`);
}
