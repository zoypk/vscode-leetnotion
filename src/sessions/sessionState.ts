export type SessionKind = "review" | "study";

export type SessionToken = Readonly<{
    kind: SessionKind;
    generation: number;
}>;

export type SessionContinuationMap = Record<SessionKind, (token: SessionToken) => Promise<void>>;

export type SessionContextUpdater = (key: string, value: boolean) => PromiseLike<unknown> | unknown;

export const sessionContextKeys = {
    active: "leetnotion.sessionActive",
    review: "leetnotion.reviewSessionActive",
    study: "leetnotion.studySessionActive",
} as const;

export const stopSessionCommandId = "leetnotion.stopSession";

export class SessionState {
    private activeToken: SessionToken | undefined;
    private generation = 0;
    private contextUpdater: SessionContextUpdater | undefined;
    private contextUpdateQueue: Promise<void> = Promise.resolve();

    constructor(contextUpdater?: SessionContextUpdater) {
        this.contextUpdater = contextUpdater;
    }

    public get active(): SessionKind | undefined {
        return this.activeToken?.kind;
    }

    public get token(): SessionToken | undefined {
        return this.activeToken;
    }

    public isActive(kind?: SessionKind): boolean {
        return kind ? this.activeToken?.kind === kind : this.activeToken !== undefined;
    }

    public owns(token: SessionToken | undefined): token is SessionToken {
        return token !== undefined && this.activeToken === token;
    }

    public async initialize(contextUpdater: SessionContextUpdater): Promise<void> {
        this.contextUpdater = contextUpdater;
        await this.publishContext();
    }

    public async acquire(kind: SessionKind): Promise<SessionToken | undefined> {
        if (this.activeToken) {
            return undefined;
        }

        const token: SessionToken = Object.freeze({
            kind,
            generation: ++this.generation,
        });
        this.activeToken = token;
        try {
            await this.publishContext();
        } catch (error) {
            if (this.owns(token)) {
                this.activeToken = undefined;
                try {
                    await this.publishContext();
                } catch {
                    // Preserve the acquisition error while leaving in-memory state inactive.
                }
            }
            throw error;
        }
        return this.owns(token) ? token : undefined;
    }

    public async release(token: SessionToken): Promise<boolean> {
        if (!this.owns(token)) {
            return false;
        }

        this.activeToken = undefined;
        await this.publishContext();
        return true;
    }

    public async stop(): Promise<boolean> {
        const token = this.activeToken;
        return token ? this.release(token) : false;
    }

    public async complete(token: SessionToken): Promise<boolean> {
        return this.release(token);
    }

    public async cancel(token: SessionToken): Promise<boolean> {
        return this.release(token);
    }

    public async continueWith(token: SessionToken | undefined, continuations: SessionContinuationMap): Promise<SessionKind | undefined> {
        if (!this.owns(token)) {
            return undefined;
        }

        await continuations[token.kind](token);
        return token.kind;
    }

    public async dispose(): Promise<void> {
        if (this.activeToken) {
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

        const activeKind = this.activeToken?.kind;
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

export function registerStopSessionCommand<T>(
    registerCommand: (command: string, handler: () => Promise<void>) => T,
    state: SessionState,
    onStopped: () => void,
): T {
    return registerCommand(stopSessionCommandId, async () => {
        if (await state.stop()) {
            onStopped();
        }
    });
}
