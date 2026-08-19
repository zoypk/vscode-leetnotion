import * as path from "path";
import type * as vscode from "vscode";
import { CacheStore } from "./cacheStore";

export const COOKIE_SECRET_KEY = "leetcode-cookie";
export const NOTION_TOKEN_SECRET_KEY = "notion-access-token";
export const MAX_MEMENTO_VALUE_BYTES = 16 * 1024;

export const LARGE_CACHE_KEYS = [
    "leetcode-topic-tags",
    "leetnotion-question-number-page-id-mapping",
    "leetnotion-title-slug-question-number-mapping",
    "notion-user-question-tags",
    "leetcode-lists",
    "leetcode-questions-of-list",
    "leetcode-problem-rating-map",
    "leetcodeContests",
] as const;

export const MEMENTO_SMALL_VALUE_KEYS = [
    "leetcode-user-status",
    "leetcode-daily-problem",
    "notion-questions-database-id",
    "notion-submissions-database-id",
    "notion-integration-status",
    "leetnotion-template-update-pending-session",
    "leetcode-pinned-sheets",
    "leetcode.hasInited",
] as const;

type StorageContext = Pick<vscode.ExtensionContext, "globalState" | "secrets" | "globalStorageUri">;

function isJsonValue(value: unknown): boolean {
    if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
        return false;
    }
    try {
        return JSON.stringify(value) !== undefined;
    } catch (_error) {
        return false;
    }
}

function isArray(value: unknown): boolean {
    return Array.isArray(value);
}

function isRecord(value: unknown): boolean {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const CACHE_VALIDATORS: Readonly<Record<string, (value: unknown) => boolean>> = {
    "leetcode-topic-tags": isRecord,
    "leetnotion-question-number-page-id-mapping": isRecord,
    "leetnotion-title-slug-question-number-mapping": isRecord,
    "notion-user-question-tags": isArray,
    "leetcode-lists": isArray,
    "leetcode-questions-of-list": isRecord,
    "leetcode-problem-rating-map": isRecord,
    "leetcodeContests": isRecord,
};

export class ExtensionStorage {
    private context: StorageContext;
    private cacheStore: CacheStore;
    private readonly mementoSnapshot = new Map<string, unknown>();
    private readonly secretSnapshot = new Map<string, string>();
    private readonly smallValueKeys = new Set<string>(MEMENTO_SMALL_VALUE_KEYS);

    public async initialize(context: StorageContext): Promise<void> {
        this.context = context;
        this.cacheStore = new CacheStore(path.join(context.globalStorageUri.fsPath, "cache"), CACHE_VALIDATORS);

        await this.migrateSecret(COOKIE_SECRET_KEY);
        await this.migrateSecret(NOTION_TOKEN_SECRET_KEY);

        const mementoWithKeys = context.globalState as typeof context.globalState & { keys?: () => readonly string[] };
        const existingKeys = mementoWithKeys.keys?.() ?? [
            COOKIE_SECRET_KEY,
            NOTION_TOKEN_SECRET_KEY,
            ...MEMENTO_SMALL_VALUE_KEYS,
            ...LARGE_CACHE_KEYS,
        ];
        for (const key of existingKeys) {
            if (key === COOKIE_SECRET_KEY || key === NOTION_TOKEN_SECRET_KEY) {
                continue;
            }
            const value = context.globalState.get(key);
            const encodedSize = value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value), "utf8");
            if (!this.smallValueKeys.has(key) || encodedSize > MAX_MEMENTO_VALUE_BYTES) {
                this.cacheStore.register(key, isJsonValue);
            }
        }
        await this.cacheStore.initialize(context.globalState);

        for (const key of MEMENTO_SMALL_VALUE_KEYS) {
            const value = context.globalState.get(key);
            if (value !== undefined && !this.cacheStore.has(key)) {
                this.mementoSnapshot.set(key, value);
            }
        }
    }

    public get<T>(key: string): T | undefined {
        if (key === COOKIE_SECRET_KEY || key === NOTION_TOKEN_SECRET_KEY) {
            return this.secretSnapshot.get(key) as T | undefined;
        }
        if (this.cacheStore.has(key)) {
            return this.cacheStore.get<T>(key);
        }
        return this.mementoSnapshot.get(key) as T | undefined;
    }

    public async update(key: string, value: unknown): Promise<void> {
        if (key === COOKIE_SECRET_KEY || key === NOTION_TOKEN_SECRET_KEY) {
            if (typeof value === "string") {
                await this.setSecret(key, value);
            } else if (value === undefined) {
                await this.deleteSecret(key);
            } else {
                throw new Error(`Secret ${key} must be a string.`);
            }
            return;
        }

        if (this.shouldUseCache(key, value)) {
            if (!this.cacheStore.has(key)) {
                this.cacheStore.register(key, isJsonValue);
            }
            if (value === undefined) {
                await this.cacheStore.delete(key);
            } else {
                await this.cacheStore.set(key, value);
            }
            if (this.context.globalState.get(key) !== undefined) {
                await this.context.globalState.update(key, undefined);
            }
            this.mementoSnapshot.delete(key);
            return;
        }

        await this.context.globalState.update(key, value);
        if (value === undefined) {
            this.mementoSnapshot.delete(key);
        } else {
            this.mementoSnapshot.set(key, value);
        }
    }

    public async clear(keys: readonly string[]): Promise<void> {
        await Promise.all(keys.map((key) => this.update(key, undefined)));
    }

    public getCacheStore(): CacheStore {
        return this.cacheStore;
    }

    private shouldUseCache(key: string, value: unknown): boolean {
        if (this.cacheStore.has(key) || !this.smallValueKeys.has(key)) {
            return true;
        }
        return value !== undefined && Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_MEMENTO_VALUE_BYTES;
    }

    private async migrateSecret(key: string): Promise<void> {
        const storedSecret = await this.context.secrets.get(key);
        if (storedSecret !== undefined) {
            this.secretSnapshot.set(key, storedSecret);
            if (this.context.globalState.get(key) !== undefined) {
                await this.context.globalState.update(key, undefined);
            }
            return;
        }

        const legacyValue = this.context.globalState.get<unknown>(key);
        if (typeof legacyValue !== "string" || legacyValue.length === 0) {
            return;
        }
        try {
            await this.context.secrets.store(key, legacyValue);
            const verified = await this.context.secrets.get(key);
            if (verified !== legacyValue) {
                throw new Error(`SecretStorage did not verify ${key}.`);
            }
            this.secretSnapshot.set(key, legacyValue);
            await this.context.globalState.update(key, undefined);
        } catch (_error) {
            this.secretSnapshot.set(key, legacyValue);
        }
    }

    private async setSecret(key: string, value: string): Promise<void> {
        await this.context.secrets.store(key, value);
        const verified = await this.context.secrets.get(key);
        if (verified !== value) {
            throw new Error(`SecretStorage did not verify ${key}.`);
        }
        this.secretSnapshot.set(key, value);
        if (this.context.globalState.get(key) !== undefined) {
            await this.context.globalState.update(key, undefined);
        }
    }

    private async deleteSecret(key: string): Promise<void> {
        await this.context.secrets.delete(key);
        this.secretSnapshot.delete(key);
        if (this.context.globalState.get(key) !== undefined) {
            await this.context.globalState.update(key, undefined);
        }
    }
}
