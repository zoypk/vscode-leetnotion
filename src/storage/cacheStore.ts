import { promises as fs } from "fs";
import * as path from "path";

export const CACHE_SCHEMA_VERSION = 1;

export type CacheValidator = (value: unknown) => boolean;

export interface CacheMemento {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

export interface CacheFileSystem {
    mkdir(directory: string, options: { recursive: true }): Promise<unknown>;
    readFile(filePath: string, encoding: "utf8"): Promise<string>;
    writeFile(filePath: string, data: string, options: { encoding: "utf8"; flag: "wx" }): Promise<unknown>;
    rename(source: string, destination: string): Promise<void>;
    unlink(filePath: string): Promise<void>;
}

const nodeFileSystem: CacheFileSystem = {
    mkdir: (directory, options) => fs.mkdir(directory, options),
    readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
    writeFile: (filePath, data, options) => fs.writeFile(filePath, data, options),
    rename: (source, destination) => fs.rename(source, destination),
    unlink: (filePath) => fs.unlink(filePath),
};

type CacheEnvelope = {
    version: number;
    key: string;
    value: unknown;
};

function isEnvelope(value: unknown, key: string): value is CacheEnvelope {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const envelope = value as Partial<CacheEnvelope>;
    return envelope.version === CACHE_SCHEMA_VERSION && envelope.key === key && "value" in envelope;
}

function fileNameForKey(key: string): string {
    return `${Buffer.from(key, "utf8").toString("hex")}.json`;
}

export class CacheStore {
    private readonly values = new Map<string, unknown>();
    private readonly writes = new Map<string, Promise<void>>();
    private readonly validators: Map<string, CacheValidator>;

    public constructor(
        private readonly cacheDirectory: string,
        validators: Readonly<Record<string, CacheValidator>>,
        private readonly fileSystem: CacheFileSystem = nodeFileSystem,
    ) {
        this.validators = new Map(Object.entries(validators));
    }

    public register(key: string, validator: CacheValidator): void {
        this.validators.set(key, validator);
    }

    public has(key: string): boolean {
        return this.validators.has(key);
    }

    public async initialize(memento?: CacheMemento): Promise<void> {
        await this.fileSystem.mkdir(this.cacheDirectory, { recursive: true });
        for (const key of this.validators.keys()) {
            const fileValue = await this.readFile(key);
            if (fileValue !== undefined) {
                this.values.set(key, fileValue);
                if (memento?.get(key) !== undefined) {
                    await memento.update(key, undefined);
                }
                continue;
            }

            const legacyValue = memento?.get(key);
            if (legacyValue === undefined) {
                continue;
            }
            if (!this.isValid(key, legacyValue)) {
                await memento!.update(key, undefined);
                continue;
            }
            await this.set(key, legacyValue);
            await memento!.update(key, undefined);
        }
    }

    public get<T>(key: string): T | undefined {
        return this.values.get(key) as T | undefined;
    }

    public async set(key: string, value: unknown): Promise<void> {
        if (!this.isValid(key, value)) {
            throw new Error(`Refusing to cache invalid value for ${key}.`);
        }
        await this.enqueue(key, async () => {
            await this.writeFile(key, value);
            this.values.set(key, value);
        });
    }

    public async delete(key: string): Promise<void> {
        await this.enqueue(key, async () => {
            await this.fileSystem.unlink(this.getFilePath(key)).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") {
                    throw error;
                }
            });
            this.values.delete(key);
        });
    }

    public async clear(): Promise<void> {
        await Promise.all(Array.from(this.validators.keys(), (key) => this.delete(key)));
    }

    public getFilePath(key: string): string {
        return path.join(this.cacheDirectory, fileNameForKey(key));
    }

    private isValid(key: string, value: unknown): boolean {
        const validator = this.validators.get(key);
        return Boolean(validator && validator(value));
    }

    private async readFile(key: string): Promise<unknown | undefined> {
        try {
            const parsed = JSON.parse(await this.fileSystem.readFile(this.getFilePath(key), "utf8")) as unknown;
            if (!isEnvelope(parsed, key) || !this.isValid(key, parsed.value)) {
                return undefined;
            }
            return parsed.value;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
                return undefined;
            }
            throw error;
        }
    }

    private async writeFile(key: string, value: unknown): Promise<void> {
        const destination = this.getFilePath(key);
        const temporary = path.join(
            this.cacheDirectory,
            `.${path.basename(destination)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
        );
        const envelope: CacheEnvelope = { version: CACHE_SCHEMA_VERSION, key, value };
        try {
            await this.fileSystem.writeFile(temporary, JSON.stringify(envelope), { encoding: "utf8", flag: "wx" });
            await this.fileSystem.rename(temporary, destination);
        } catch (error) {
            await this.fileSystem.unlink(temporary).catch(() => undefined);
            throw error;
        }
    }

    private async enqueue(key: string, operation: () => Promise<void>): Promise<void> {
        const prior = this.writes.get(key) ?? Promise.resolve();
        const current = prior.catch(() => undefined).then(operation);
        this.writes.set(key, current);
        try {
            await current;
        } finally {
            if (this.writes.get(key) === current) {
                this.writes.delete(key);
            }
        }
    }
}
