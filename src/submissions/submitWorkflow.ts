import type { SubmissionBaseline, SubmissionCorrelationRequest, SubmissionSourceSnapshot, ValidatedSubmission } from "./types";

export interface SubmitWorkflowDependencies {
    createSourceSnapshot: (filePath: string) => Promise<SubmissionSourceSnapshot>;
    captureBaseline: (questionNumber: string) => Promise<SubmissionBaseline>;
    submit: (filePath: string) => Promise<string>;
    correlate: (request: SubmissionCorrelationRequest) => Promise<ValidatedSubmission>;
    showResult: (result: string, submission?: ValidatedSubmission) => void;
    shouldSyncToNotion: () => boolean;
    syncToNotion: (submission: ValidatedSubmission) => Promise<void>;
    refreshExplorer: () => void | Promise<void>;
    reportCorrelationFailure: (error: unknown) => void;
    showCorrelationWarning: () => void;
    now?: () => number;
}

const pendingQuestionWorkflows = new Map<string, Promise<void>>();

async function serializeQuestionWorkflow<T>(questionNumber: string, workflow: () => Promise<T>): Promise<T> {
    const previousWorkflow = pendingQuestionWorkflows.get(questionNumber) ?? Promise.resolve();
    let releaseCurrentWorkflow: () => void = () => undefined;
    const currentWorkflow = new Promise<void>((resolve) => {
        releaseCurrentWorkflow = resolve;
    });
    pendingQuestionWorkflows.set(questionNumber, currentWorkflow);

    await previousWorkflow.catch(() => undefined);
    try {
        return await workflow();
    } finally {
        releaseCurrentWorkflow();
        if (pendingQuestionWorkflows.get(questionNumber) === currentWorkflow) {
            pendingQuestionWorkflows.delete(questionNumber);
        }
    }
}

export function isAcceptedSubmission(submission: ValidatedSubmission): boolean {
    const status = submission.detail.details.status_msg
        ?? submission.detail.details.compare_result;
    return typeof status === "string" && status.trim().toLowerCase() === "accepted";
}

export async function runSubmitWorkflow(filePath: string, dependencies: SubmitWorkflowDependencies): Promise<void> {
    let sourceSnapshot: SubmissionSourceSnapshot | undefined;
    try {
        sourceSnapshot = await dependencies.createSourceSnapshot(filePath);
        await serializeQuestionWorkflow(sourceSnapshot.questionNumber, async () => {
            const baseline = await dependencies.captureBaseline(sourceSnapshot.questionNumber);
            const startedAtMs = (dependencies.now ?? Date.now)();
            const result = await dependencies.submit(sourceSnapshot.filePath);

            let validatedSubmission: ValidatedSubmission;
            try {
                validatedSubmission = await dependencies.correlate({
                    ...baseline,
                    submittedCode: sourceSnapshot.code,
                    startedAtMs,
                });
            } catch (error) {
                dependencies.reportCorrelationFailure(error);
                dependencies.showResult(result);
                dependencies.showCorrelationWarning();
                return;
            }

            dependencies.showResult(result, validatedSubmission);
            if (dependencies.shouldSyncToNotion() && isAcceptedSubmission(validatedSubmission)) {
                await dependencies.syncToNotion(validatedSubmission);
            }
        });
    } finally {
        try {
            await sourceSnapshot?.dispose();
        } finally {
            await dependencies.refreshExplorer();
        }
    }
}
