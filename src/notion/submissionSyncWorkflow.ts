export interface SubmissionSyncCompletion {
    attachPanel(): boolean | Promise<boolean>;
    addCode(): void | Promise<void>;
    reportPanelError(error: unknown): void;
}

export async function completeSubmissionSync(completion: SubmissionSyncCompletion): Promise<void> {
    try {
        await completion.attachPanel();
    } catch (error) {
        completion.reportPanelError(error);
    }
    await completion.addCode();
}
