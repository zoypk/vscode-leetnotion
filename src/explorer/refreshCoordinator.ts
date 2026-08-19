export interface RefreshCoordinatorOptions<T> {
    buildSnapshot: (generation: number) => Promise<T>;
    installSnapshot: (snapshot: T, generation: number) => void;
    reportError?: (error: unknown, generation: number) => void | Promise<void>;
}

/**
 * Serializes refresh work while retaining only the newest requested generation.
 * A snapshot is published only after it has been built completely.
 */
export class RefreshCoordinator<T> {
    private completedGeneration: number = 0;
    private requestedGeneration: number = 0;
    private runningRefresh: Promise<void> | undefined;

    constructor(private readonly options: RefreshCoordinatorOptions<T>) { }

    public requestRefresh(): Promise<void> {
        this.requestedGeneration += 1;
        if (!this.runningRefresh) {
            this.runningRefresh = this.runRefreshes().finally(() => {
                this.runningRefresh = undefined;
            });
        }
        return this.runningRefresh;
    }

    private async runRefreshes(): Promise<void> {
        while (this.completedGeneration < this.requestedGeneration) {
            const generation = this.requestedGeneration;
            try {
                const snapshot = await this.options.buildSnapshot(generation);
                this.completedGeneration = generation;
                if (generation === this.requestedGeneration) {
                    this.options.installSnapshot(snapshot, generation);
                }
            } catch (error) {
                this.completedGeneration = generation;
                if (generation === this.requestedGeneration && this.options.reportError) {
                    await this.options.reportError(error, generation);
                }
            }
        }
    }
}

