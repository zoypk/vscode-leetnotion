import type { SubmissionBaseline, SubmissionCorrelationRequest, SubmissionSource, ValidatedSubmission } from "./types";

export interface SubmitWorkflowDependencies {
    readSource: (filePath: string) => Promise<SubmissionSource>;
    captureBaseline: (questionNumber: string) => Promise<SubmissionBaseline>;
    submit: (filePath: string) => Promise<string>;
    correlate: (request: SubmissionCorrelationRequest) => Promise<ValidatedSubmission>;
    showResult: (result: string, submission?: ValidatedSubmission) => void;
    shouldSyncToNotion: () => boolean;
    syncToNotion: (submission: ValidatedSubmission) => Promise<void>;
    refreshExplorer: () => void | Promise<void>;
    reportCorrelationFailure: (error: unknown) => void;
    now?: () => number;
}

export function isAcceptedSubmission(submission: ValidatedSubmission): boolean {
    const status = submission.detail.details.status_msg
        ?? submission.detail.details.compare_result
        ?? submission.submission.status_display;
    return status.trim().toLowerCase() === "accepted";
}

export async function runSubmitWorkflow(filePath: string, dependencies: SubmitWorkflowDependencies): Promise<void> {
    try {
        const source = await dependencies.readSource(filePath);
        const baseline = await dependencies.captureBaseline(source.questionNumber);
        const startedAtMs = (dependencies.now ?? Date.now)();
        const result = await dependencies.submit(filePath);

        let validatedSubmission: ValidatedSubmission;
        try {
            validatedSubmission = await dependencies.correlate({
                ...baseline,
                submittedCode: source.code,
                startedAtMs,
            });
        } catch (error) {
            dependencies.reportCorrelationFailure(error);
            dependencies.showResult(result);
            return;
        }

        dependencies.showResult(result, validatedSubmission);
        if (dependencies.shouldSyncToNotion() && isAcceptedSubmission(validatedSubmission)) {
            await dependencies.syncToNotion(validatedSubmission);
        }
    } finally {
        await dependencies.refreshExplorer();
    }
}
