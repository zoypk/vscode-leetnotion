import type { LeetcodeSubmission, SubmissionDetailView } from "../types";

export interface SubmissionSource {
    questionNumber: string;
    code: string;
}

export interface SubmissionSourceSnapshot extends SubmissionSource {
    filePath: string;
    dispose: () => Promise<void>;
}

export interface SubmissionBaseline {
    questionNumber: string;
    expectedSlug: string;
    submissionIds: number[];
}

export interface SubmissionCorrelationRequest extends SubmissionBaseline {
    submittedCode: string;
    startedAtMs: number;
    timeoutMs?: number;
    pollIntervalMs?: number;
    clockSkewMs?: number;
}

export interface ValidatedSubmission {
    questionNumber: string;
    submission: LeetcodeSubmission;
    detail: SubmissionDetailView;
}
