export interface RefreshCoordinatorOptions<T> {
    buildSnapshot: (generation: number) => Promise<T>;
    installSnapshot: (snapshot: T, generation: number) => void;
    reportError?: (error: unknown, generation: number) => void | Promise<void>;
}

interface ActiveRefresh {
    promise: Promise<void>;
    resolve: () => void;
}

/**
 * Serializes refresh work while retaining only the newest requested generation.
 * A snapshot is published only after it has been built completely.
 */
export class RefreshCoordinator<T> {
    private completedGeneration: number = 0;
    private disposed: boolean = false;
    private requestedGeneration: number = 0;
    private runningRefresh: ActiveRefresh | undefined;

    constructor(private readonly options: RefreshCoordinatorOptions<T>) { }

    public requestRefresh(): Promise<void> {
        if (this.disposed) {
            return Promise.resolve();
        }
        this.requestedGeneration += 1;
        if (!this.runningRefresh) {
            let resolveRefresh: () => void;
            const promise = new Promise<void>((resolve) => {
                resolveRefresh = resolve;
            });
            const refresh = { promise, resolve: resolveRefresh };
            this.runningRefresh = refresh;
            void this.runRefreshes(refresh);
        }
        return this.runningRefresh.promise;
    }

    public dispose(): void {
        this.disposed = true;
        this.requestedGeneration += 1;
    }

    private async runRefreshes(refresh: ActiveRefresh): Promise<void> {
        try {
            while (!this.disposed && this.completedGeneration < this.requestedGeneration) {
                const generation = this.requestedGeneration;
                try {
                    const snapshot = await this.options.buildSnapshot(generation);
                    if (this.disposed) {
                        break;
                    }
                    this.completedGeneration = generation;
                    if (generation === this.requestedGeneration) {
                        this.options.installSnapshot(snapshot, generation);
                    }
                } catch (error) {
                    if (this.disposed) {
                        break;
                    }
                    this.completedGeneration = generation;
                    if (generation === this.requestedGeneration && this.options.reportError) {
                        await Promise.resolve(this.options.reportError(error, generation)).catch(() => undefined);
                    }
                }
            }
        } finally {
            if (this.runningRefresh === refresh) {
                this.runningRefresh = undefined;
            }
            refresh.resolve();
        }
    }
}
