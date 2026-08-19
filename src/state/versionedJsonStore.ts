import { promises as fs } from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

export interface VersionedJsonStoreOptions<T> {
    filePath: string | (() => string);
    createEmpty: () => T;
    parse: (value: unknown, sourcePath: string) => T;
    lockRetryMs?: number;
    lockTimeoutMs?: number;
    staleLockMs?: number;
    now?: () => number;
    onTempFile?: (tempPath: string) => void;
    onLockOpened?: (lockPath: string, ownerToken: string) => void;
}

const processQueues = new Map<string, Promise<void>>();

export class VersionedJsonStore<T> {
    private readonly lockRetryMs: number;
    private readonly lockTimeoutMs: number;
    private readonly staleLockMs: number;
    private readonly now: () => number;

    constructor(private readonly options: VersionedJsonStoreOptions<T>) {
        this.lockRetryMs = options.lockRetryMs ?? 25;
        this.lockTimeoutMs = options.lockTimeoutMs ?? 5000;
        this.staleLockMs = options.staleLockMs ?? 30000;
        this.now = options.now ?? Date.now;
    }

    public async read(): Promise<T> {
        const filePath = this.getFilePath();
        return this.readFromDisk(filePath);
    }

    public async transaction<R>(mutator: (state: T) => R extends PromiseLike<unknown> ? never : R): Promise<R> {
        const filePath = this.getFilePath();
        return this.enqueue(filePath, async () => {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            const lockPath = `${filePath}.lock`;
            const ownerToken = await this.acquireLock(lockPath);
            let tempPath: string | undefined;

            try {
                const state = await this.readFromDisk(filePath);
                const result = mutator(state);
                if (this.isPromiseLike(result)) {
                    void Promise.resolve(result).catch(() => undefined);
                    throw new Error("VersionedJsonStore transaction mutator must be synchronous.");
                }
                const validatedState = this.options.parse(state, filePath);
                const serialized = `${JSON.stringify(validatedState, undefined, 2)}\n`;
                const current = await this.readExistingText(filePath);
                if (current !== serialized) {
                    await this.assertLockOwned(lockPath, ownerToken);
                    tempPath = this.createTempPath(filePath);
                    this.options.onTempFile?.(tempPath);
                    await fs.writeFile(tempPath, serialized, { encoding: "utf8", flag: "wx" });
                    await this.assertLockOwned(lockPath, ownerToken);
                    await fs.rename(tempPath, filePath);
                    tempPath = undefined;
                }
                return result;
            } finally {
                if (tempPath) {
                    await fs.unlink(tempPath).catch(() => undefined);
                }
                await this.releaseLockIfOwned(lockPath, ownerToken);
            }
        });
    }

    private getFilePath(): string {
        const value = typeof this.options.filePath === "function" ? this.options.filePath() : this.options.filePath;
        return path.resolve(value);
    }

    private async readFromDisk(filePath: string): Promise<T> {
        let raw: string;
        try {
            raw = await fs.readFile(filePath, "utf8");
        } catch (error) {
            if (this.isNodeError(error, "ENOENT")) {
                return this.options.parse(this.options.createEmpty(), filePath);
            }
            throw new Error(`Failed to read state from ${filePath}: ${this.errorMessage(error)}`);
        }

        let value: unknown;
        try {
            value = JSON.parse(raw);
        } catch (error) {
            throw new Error(`Failed to parse state from ${filePath}: ${this.errorMessage(error)}`);
        }
        return this.options.parse(value, filePath);
    }

    private async acquireLock(lockPath: string): Promise<string> {
        const deadline = this.now() + this.lockTimeoutMs;
        while (true) {
            try {
                const handle = await fs.open(lockPath, "wx");
                const ownerToken = randomBytes(24).toString("hex");
                let openedStats: import("fs").Stats | undefined;
                let tokenWritten = false;
                let setupError: unknown;
                try {
                    openedStats = await handle.stat();
                    await handle.writeFile(JSON.stringify({
                        ownerToken,
                        pid: process.pid,
                        createdAt: new Date(this.now()).toISOString(),
                    }));
                    tokenWritten = true;
                    this.options.onLockOpened?.(lockPath, ownerToken);
                } catch (error) {
                    setupError = error;
                } finally {
                    await handle.close().catch(() => undefined);
                }
                if (setupError) {
                    if (tokenWritten) {
                        await this.releaseLockIfOwned(lockPath, ownerToken);
                    } else if (openedStats) {
                        await this.releaseCreatedLockIfSameFile(lockPath, openedStats);
                    }
                    throw setupError;
                }
                return ownerToken;
            } catch (error) {
                if (!this.isNodeError(error, "EEXIST")) {
                    throw new Error(`Failed to acquire state lock ${lockPath}: ${this.errorMessage(error)}`);
                }
                if (await this.isStaleLock(lockPath)) {
                    await fs.unlink(lockPath).catch((unlinkError) => {
                        if (!this.isNodeError(unlinkError, "ENOENT")) {
                            throw unlinkError;
                        }
                    });
                    continue;
                }
                if (this.now() >= deadline) {
                    throw new Error(`Timed out waiting for state lock ${lockPath}. Another extension process may still be writing.`);
                }
                await new Promise((resolve) => setTimeout(resolve, this.lockRetryMs));
            }
        }
    }

    private async assertLockOwned(lockPath: string, ownerToken: string): Promise<void> {
        const currentOwner = await this.readLockOwner(lockPath);
        if (currentOwner !== ownerToken) {
            throw new Error(`Lost ownership of state lock ${lockPath}; refusing to write state.`);
        }
    }

    private async releaseLockIfOwned(lockPath: string, ownerToken: string): Promise<void> {
        if (await this.readLockOwner(lockPath) !== ownerToken) {
            return;
        }
        await fs.unlink(lockPath).catch((error) => {
            if (!this.isNodeError(error, "ENOENT")) {
                throw error;
            }
        });
    }

    private async readLockOwner(lockPath: string): Promise<string | undefined> {
        try {
            const raw = await fs.readFile(lockPath, "utf8");
            const parsed = JSON.parse(raw) as { ownerToken?: unknown };
            return typeof parsed.ownerToken === "string" ? parsed.ownerToken : undefined;
        } catch (error) {
            if (this.isNodeError(error, "ENOENT") || error instanceof SyntaxError) {
                return undefined;
            }
            throw error;
        }
    }

    private async releaseCreatedLockIfSameFile(lockPath: string, openedStats: import("fs").Stats): Promise<void> {
        try {
            const currentStats = await fs.stat(lockPath);
            const sameFile = currentStats.dev === openedStats.dev
                && currentStats.ino === openedStats.ino
                && currentStats.birthtimeMs === openedStats.birthtimeMs;
            if (sameFile) {
                await fs.unlink(lockPath);
            }
        } catch (error) {
            if (!this.isNodeError(error, "ENOENT")) {
                throw error;
            }
        }
    }

    private async isStaleLock(lockPath: string): Promise<boolean> {
        try {
            const lockStats = await fs.stat(lockPath);
            return this.now() - lockStats.mtimeMs > this.staleLockMs;
        } catch (error) {
            if (this.isNodeError(error, "ENOENT")) {
                return true;
            }
            throw error;
        }
    }

    private createTempPath(filePath: string): string {
        const uniquePart = `${process.pid}-${this.now()}-${Math.random().toString(16).slice(2)}`;
        return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${uniquePart}.tmp`);
    }

    private async readExistingText(filePath: string): Promise<string | undefined> {
        try {
            return await fs.readFile(filePath, "utf8");
        } catch (error) {
            if (this.isNodeError(error, "ENOENT")) {
                return undefined;
            }
            throw error;
        }
    }

    private async enqueue<R>(filePath: string, operation: () => Promise<R>): Promise<R> {
        const previous = processQueues.get(filePath) ?? Promise.resolve();
        let release: () => void = () => undefined;
        const current = new Promise<void>((resolve) => { release = resolve; });
        const queued = previous.then(() => current);
        processQueues.set(filePath, queued);
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (processQueues.get(filePath) === queued) {
                processQueues.delete(filePath);
            }
        }
    }

    private isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
        return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
    }

    private isPromiseLike(value: unknown): value is PromiseLike<unknown> {
        return Boolean(value && (typeof value === "object" || typeof value === "function")
            && typeof (value as PromiseLike<unknown>).then === "function");
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : `${error}`;
    }
}
