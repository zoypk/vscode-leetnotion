export class ActivationDisposalError extends Error {
    public constructor(public readonly errors: unknown[]) {
        super(`Failed to dispose ${errors.length} activation resource${errors.length === 1 ? "" : "s"}.`);
        this.name = "ActivationDisposalError";
    }
}
