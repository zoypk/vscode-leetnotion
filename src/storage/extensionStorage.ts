import * as path from "path";
import type * as vscode from "vscode";
import { CacheStore } from "./cacheStore";

export const COOKIE_SECRET_KEY = "leetcode-cookie";
export const NOTION_TOKEN_SECRET_KEY = "notion-access-token";
export const MAX_MEMENTO_VALUE_BYTES = 16 * 1024;
export const CACHE_KEY_INDEX = "leetnotion-file-cache-key-index";

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
    CACHE_KEY_INDEX,
] as const;

const LEGACY_SESSION_FIELDS = ["isProblemsRetrieved", "updatedPages", "leetcodeProblems"] as const;

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

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
    return Array.isArray(value) && value.every(isString);
}

function isStringArrayMap(value: unknown): boolean {
    return isRecord(value) && Object.values(value).every(isStringArray);
}

function isStringMap(value: unknown): boolean {
    return isRecord(value) && Object.values(value).every(isString);
}

function isListCollection(value: unknown): boolean {
    return Array.isArray(value) && value.every((item) => isRecord(item)
        && isString(item.name) && isString(item.slug));
}

function isQuestionCollection(value: unknown): boolean {
    return isRecord(value) && Object.values(value).every((questions) => Array.isArray(questions)
        && questions.every((question) => isRecord(question)
            && typeof question.id === "number" && Number.isFinite(question.id)
            && isString(question.questionFrontendId)
            && isString(question.title)
            && isString(question.titleSlug)));
}

function isRatingMap(value: unknown): boolean {
    return isRecord(value) && Object.values(value).every((rating) => isRecord(rating)
        && typeof rating.ID === "number" && Number.isFinite(rating.ID)
        && typeof rating.Rating === "number" && Number.isFinite(rating.Rating)
        && isString(rating.ContestID_en)
        && isString(rating.ProblemIndex));
}

export const CACHE_VALIDATORS: Readonly<Record<string, (value: unknown) => boolean>> = {
    "leetcode-topic-tags": isStringArrayMap,
    "leetnotion-question-number-page-id-mapping": isStringMap,
    "leetnotion-title-slug-question-number-mapping": isStringMap,
    "notion-user-question-tags": isStringArray,
    "leetcode-lists": isListCollection,
    "leetcode-questions-of-list": isQuestionCollection,
    "leetcode-problem-rating-map": isRatingMap,
    "leetcodeContests": isStringArrayMap,
};

function encodedSize(value: unknown): number {
    try {
        const encoded = JSON.stringify(value);
        return encoded === undefined ? Number.POSITIVE_INFINITY : Buffer.byteLength(encoded, "utf8");
    } catch (_error) {
        return Number.POSITIVE_INFINITY;
    }
}

function isValidSecret(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

export class ExtensionStorage {
    private context: StorageContext;
    private cacheStore: CacheStore;
    private readonly mementoSnapshot = new Map<string, unknown>();
    private readonly secretSnapshot = new Map<string, string>();
    private readonly smallValueKeys = new Set<string>(MEMENTO_SMALL_VALUE_KEYS);
    private readonly indexedCacheKeys = new Set<string>();

    public async initialize(context: StorageContext): Promise<void> {
        this.mementoSnapshot.clear();
        this.secretSnapshot.clear();
        this.indexedCacheKeys.clear();
        this.context = context;
        this.cacheStore = new CacheStore(path.join(context.globalStorageUri.fsPath, "cache"), CACHE_VALIDATORS);

        await this.migrateSecret(COOKIE_SECRET_KEY);
        await this.migrateSecret(NOTION_TOKEN_SECRET_KEY);

        const rawIndex = context.globalState.get<unknown>(CACHE_KEY_INDEX);
        if (Array.isArray(rawIndex) && rawIndex.every(isString)) {
            for (const key of rawIndex) {
                if (!LARGE_CACHE_KEYS.includes(key as typeof LARGE_CACHE_KEYS[number])) {
                    this.indexedCacheKeys.add(key);
                }
            }
        } else if (rawIndex !== undefined) {
            await context.globalState.update(CACHE_KEY_INDEX, undefined);
        }

        const mementoWithKeys = context.globalState as typeof context.globalState & { keys?: () => readonly string[] };
        const existingKeys = new Set<string>(mementoWithKeys.keys?.() ?? [
            COOKIE_SECRET_KEY,
            NOTION_TOKEN_SECRET_KEY,
            ...MEMENTO_SMALL_VALUE_KEYS,
            ...LARGE_CACHE_KEYS,
        ]);
        for (const key of this.indexedCacheKeys) {
            existingKeys.add(key);
        }
        const pendingSession = context.globalState.get<unknown>("leetnotion-template-update-pending-session");
        if (isRecord(pendingSession) && isString(pendingSession.id)) {
            for (const field of LEGACY_SESSION_FIELDS) {
                existingKeys.add(`${pendingSession.id}.${field}`);
            }
        }
        for (const key of existingKeys) {
            if (key === COOKIE_SECRET_KEY || key === NOTION_TOKEN_SECRET_KEY || key === CACHE_KEY_INDEX) {
                continue;
            }
            const value = context.globalState.get(key);
            const valueSize = value === undefined ? 0 : encodedSize(value);
            if ((!this.smallValueKeys.has(key) || valueSize > MAX_MEMENTO_VALUE_BYTES)
                && !this.cacheStore.has(key)) {
                this.cacheStore.register(key, isJsonValue);
            }
        }
        await this.cacheStore.initialize(context.globalState);

        this.indexedCacheKeys.clear();
        for (const key of existingKeys) {
            if (this.cacheStore.has(key) && !this.isNamedLargeCacheKey(key)
                && this.cacheStore.get(key) !== undefined) {
                this.indexedCacheKeys.add(key);
            }
        }
        await this.persistCacheKeyIndex();

        for (const key of MEMENTO_SMALL_VALUE_KEYS) {
            if (key === CACHE_KEY_INDEX) {
                continue;
            }
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
            if (isValidSecret(value)) {
                await this.setSecret(key, value);
            } else if (value === undefined) {
                await this.deleteSecret(key);
            } else {
                throw new Error(`Secret ${key} must be a non-empty string.`);
            }
            return;
        }

        if (this.shouldUseCache(key, value)) {
            if (!this.cacheStore.has(key)) {
                this.cacheStore.register(key, isJsonValue);
            }
            const requiresIndex = !this.isNamedLargeCacheKey(key);
            const wasIndexed = this.indexedCacheKeys.has(key);
            if (value !== undefined && requiresIndex && !wasIndexed) {
                this.indexedCacheKeys.add(key);
                await this.persistCacheKeyIndex();
            }
            if (value === undefined) {
                await this.cacheStore.delete(key);
            } else {
                try {
                    await this.cacheStore.set(key, value);
                } catch (error) {
                    if (requiresIndex && !wasIndexed) {
                        this.indexedCacheKeys.delete(key);
                        await this.persistCacheKeyIndex();
                    }
                    throw error;
                }
            }
            if (this.context.globalState.get(key) !== undefined) {
                await this.context.globalState.update(key, undefined);
            }
            this.mementoSnapshot.delete(key);
            if (value === undefined && requiresIndex && wasIndexed) {
                this.indexedCacheKeys.delete(key);
                await this.persistCacheKeyIndex();
            }
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
        return value !== undefined && encodedSize(value) > MAX_MEMENTO_VALUE_BYTES;
    }

    private isNamedLargeCacheKey(key: string): boolean {
        return LARGE_CACHE_KEYS.includes(key as typeof LARGE_CACHE_KEYS[number]);
    }

    private async persistCacheKeyIndex(): Promise<void> {
        const keys = Array.from(this.indexedCacheKeys).sort();
        await this.context.globalState.update(CACHE_KEY_INDEX, keys.length > 0 ? keys : undefined);
    }

    private async migrateSecret(key: string): Promise<void> {
        const legacyValue = this.context.globalState.get<unknown>(key);
        const validLegacyValue = isValidSecret(legacyValue) ? legacyValue : undefined;
        let storedSecret: string | undefined;
        try {
            storedSecret = await this.context.secrets.get(key);
        } catch (_error) {
            if (validLegacyValue) {
                this.secretSnapshot.set(key, validLegacyValue);
            } else if (legacyValue !== undefined) {
                await this.context.globalState.update(key, undefined);
            }
            return;
        }

        if (isValidSecret(storedSecret)) {
            this.secretSnapshot.set(key, storedSecret);
            if (legacyValue !== undefined) {
                await this.context.globalState.update(key, undefined);
            }
            return;
        }

        if (storedSecret !== undefined) {
            await this.context.secrets.delete(key);
        }
        if (!validLegacyValue) {
            if (legacyValue !== undefined) {
                await this.context.globalState.update(key, undefined);
            }
            return;
        }
        try {
            await this.context.secrets.store(key, validLegacyValue);
            const verified = await this.context.secrets.get(key);
            if (verified !== validLegacyValue) {
                throw new Error(`SecretStorage did not verify ${key}.`);
            }
            this.secretSnapshot.set(key, validLegacyValue);
            await this.context.globalState.update(key, undefined);
        } catch (_error) {
            this.secretSnapshot.set(key, validLegacyValue);
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
