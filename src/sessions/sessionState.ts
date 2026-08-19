export type SessionKind = "review" | "study";

export type SessionContinuationMap = Record<SessionKind, () => Promise<void>>;

export type SessionContextUpdater = (key: string, value: boolean) => PromiseLike<unknown> | unknown;

export const sessionContextKeys = {
    active: "leetnotion.sessionActive",
    review: "leetnotion.reviewSessionActive",
    study: "leetnotion.studySessionActive",
} as const;

export class SessionState {
    private activeKind: SessionKind | undefined;
    private contextUpdater: SessionContextUpdater | undefined;
    private contextUpdateQueue: Promise<void> = Promise.resolve();

    constructor(contextUpdater?: SessionContextUpdater) {
        this.contextUpdater = contextUpdater;
    }

    public get active(): SessionKind | undefined {
        return this.activeKind;
    }

    public isActive(kind?: SessionKind): boolean {
        return kind ? this.activeKind === kind : this.activeKind !== undefined;
    }

    public async initialize(contextUpdater: SessionContextUpdater): Promise<void> {
        this.contextUpdater = contextUpdater;
        await this.publishContext();
    }

    public async start(kind: SessionKind): Promise<void> {
        this.activeKind = kind;
        await this.publishContext();
    }

    public async stop(expectedKind?: SessionKind): Promise<boolean> {
        if (!this.activeKind || (expectedKind && this.activeKind !== expectedKind)) {
            return false;
        }

        this.activeKind = undefined;
        await this.publishContext();
        return true;
    }

    public async complete(kind: SessionKind): Promise<boolean> {
        return this.stop(kind);
    }

    public async cancel(kind: SessionKind): Promise<boolean> {
        return this.stop(kind);
    }

    public async continueWith(continuations: SessionContinuationMap): Promise<SessionKind | undefined> {
        const activeKind = this.activeKind;
        if (!activeKind) {
            return undefined;
        }

        await continuations[activeKind]();
        return activeKind;
    }

    public async dispose(): Promise<void> {
        if (this.activeKind) {
            await this.stop();
            return;
        }

        await this.publishContext();
    }

    private publishContext(): Promise<void> {
        const updater = this.contextUpdater;
        if (!updater) {
            return Promise.resolve();
        }

        const activeKind = this.activeKind;
        const publish = async () => {
            await updater(sessionContextKeys.active, activeKind !== undefined);
            await updater(sessionContextKeys.review, activeKind === "review");
            await updater(sessionContextKeys.study, activeKind === "study");
        };
        this.contextUpdateQueue = this.contextUpdateQueue.then(publish, publish);
        return this.contextUpdateQueue;
    }
}

export const sessionState = new SessionState();
