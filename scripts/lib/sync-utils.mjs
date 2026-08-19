import { execFileSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_NETWORK_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_REDIRECTS = 5;

export function createSiblingTempPath(targetPath, label = "tmp") {
    return `${targetPath}.${label}-${process.pid}-${randomUUID()}`;
}

export function downloadBuffer(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;
    const maxBytes = options.maxBytes;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new Error("downloadBuffer requires a positive maxBytes limit");
    }
    return downloadBufferWithRedirects(url, {
        deadline: Date.now() + timeoutMs,
        headers: options.headers ?? {}, maxBytes, maxRedirects, timeoutMs,
    });
}

async function downloadBufferWithRedirects(url, options) {
    return new Promise((resolve, reject) => {
        const remainingTimeMs = options.deadline - Date.now();
        if (remainingTimeMs <= 0) {
            reject(new Error(`Download timed out after ${options.timeoutMs}ms: ${url}`));
            return;
        }
        const parsedUrl = new URL(url);
        const get = parsedUrl.protocol === "http:" ? httpGet : parsedUrl.protocol === "https:" ? httpsGet : undefined;
        if (!get) {
            reject(new Error(`Unsupported download protocol: ${parsedUrl.protocol}`));
            return;
        }
        let settled = false;
        let deadlineTimer;
        const clearDeadline = () => {
            if (deadlineTimer) {
                clearTimeout(deadlineTimer);
                deadlineTimer = undefined;
            }
        };
        const fail = (error) => {
            if (!settled) {
                settled = true;
                clearDeadline();
                reject(error);
            }
        };
        const request = get(parsedUrl, { headers: options.headers }, (response) => {
            const statusCode = response.statusCode ?? 0;
            const location = response.headers.location;
            if (location && statusCode >= 300 && statusCode < 400) {
                if (options.maxRedirects <= 0) {
                    fail(new Error(`Too many redirects while downloading ${url}`));
                    response.destroy();
                    return;
                }
                settled = true;
                clearDeadline();
                response.destroy();
                resolve(downloadBufferWithRedirects(new URL(location, url).toString(), {
                    ...options, maxRedirects: options.maxRedirects - 1,
                }));
                return;
            }
            if (statusCode !== 200) {
                fail(new Error(`Failed to download ${url}: HTTP ${statusCode}`));
                response.destroy();
                return;
            }
            const contentLength = Number(response.headers["content-length"]);
            if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
                fail(new Error(`Download exceeded ${options.maxBytes} bytes: ${url}`));
                response.destroy();
                return;
            }
            const chunks = [];
            let receivedBytes = 0;
            response.on("data", (chunk) => {
                if (settled) { return; }
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                receivedBytes += buffer.length;
                if (receivedBytes > options.maxBytes) {
                    response.destroy();
                    fail(new Error(`Download exceeded ${options.maxBytes} bytes: ${url}`));
                    return;
                }
                chunks.push(buffer);
            });
            response.on("end", () => {
                if (!settled) {
                    settled = true;
                    clearDeadline();
                    resolve(Buffer.concat(chunks));
                }
            });
            response.on("error", fail);
        });
        deadlineTimer = setTimeout(() => {
            request.destroy(new Error(`Download timed out after ${options.timeoutMs}ms: ${url}`));
        }, remainingTimeMs);
        request.on("error", fail);
    });
}

export async function downloadText(url, options) {
    return (await downloadBuffer(url, options)).toString(options.encoding ?? "utf8");
}

export function runGit(argumentsToRun, options = {}) {
    return execFileSync("git", argumentsToRun, {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
        stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
        timeout: options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS,
    }).trim();
}

export function resolveRemoteHead(repositoryUrl, branch = "main", options = {}) {
    const reference = `refs/heads/${branch}`;
    const output = runGit(["ls-remote", repositoryUrl, reference], options);
    const match = output.split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/))
        .find(([, returnedReference]) => returnedReference === reference);
    if (!match || !/^[0-9a-f]{40}$/i.test(match[0])) {
        throw new Error(`Could not resolve ${reference} from ${repositoryUrl}`);
    }
    return match[0].toLowerCase();
}

export function checkoutExactRevision(repositoryUrl, revision, targetDirectory, options = {}) {
    if (!/^[0-9a-f]{40}$/i.test(revision)) {
        throw new Error(`Invalid Git revision: ${revision}`);
    }
    mkdirSync(targetDirectory, { recursive: true });
    runGit(["init", "--quiet", targetDirectory], options);
    runGit(["-C", targetDirectory, "remote", "add", "origin", repositoryUrl], options);
    runGit(["-C", targetDirectory, "fetch", "--quiet", "--depth", "1", "origin", revision], options);
    runGit(["-C", targetDirectory, "checkout", "--quiet", "--detach", "FETCH_HEAD"], options);
    const checkedOutRevision = runGit(["-C", targetDirectory, "rev-parse", "HEAD"], options).toLowerCase();
    if (checkedOutRevision !== revision.toLowerCase()) {
        throw new Error(`Expected checkout ${revision}, received ${checkedOutRevision}`);
    }
}

export function atomicReplaceFile(targetPath, content, options = {}) {
    const fsOperations = {
        existsSync, mkdirSync, renameSync, rmSync, writeFileSync,
        ...options.fsOperations,
    };
    const tempPath = createSiblingTempPath(targetPath, "tmp");
    try {
        fsOperations.mkdirSync(dirname(targetPath), { recursive: true });
        fsOperations.writeFileSync(tempPath, content, options.encoding ?? "utf8");
        options.validate?.(tempPath);
        fsOperations.renameSync(tempPath, targetPath);
    } finally {
        try {
            if (fsOperations.existsSync(tempPath)) {
                fsOperations.rmSync(tempPath, { force: true });
            }
        } catch (_cleanupError) {
            // The replacement result is authoritative; temporary cleanup is best effort.
        }
    }
}

export function atomicWriteFiles(outputs, options = {}) {
    if (!Array.isArray(outputs) || outputs.length === 0) {
        throw new Error("atomicWriteFiles requires at least one output");
    }
    const targets = new Set();
    for (const output of outputs) {
        if (!output?.path || targets.has(output.path)) {
            throw new Error(`Duplicate or missing output path: ${output?.path ?? "<missing>"}`);
        }
        targets.add(output.path);
    }
    const fsOperations = {
        existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
        ...options.fsOperations,
    };
    const staged = outputs.map((output) => ({
        ...output,
        backupPath: createSiblingTempPath(output.path, "backup"),
        tempPath: createSiblingTempPath(output.path, "tmp"),
        hadOriginal: false,
        installed: false,
    }));
    let committed = false;
    try {
        for (const entry of staged) {
            fsOperations.mkdirSync(dirname(entry.path), { recursive: true });
            fsOperations.writeFileSync(entry.tempPath, entry.content, entry.encoding ?? "utf8");
        }
        options.validate?.(new Map(staged.map((entry) => [entry.path, entry.tempPath])));
        for (const entry of staged) {
            entry.hadOriginal = fsOperations.existsSync(entry.path);
            if (entry.hadOriginal) { fsOperations.renameSync(entry.path, entry.backupPath); }
            fsOperations.renameSync(entry.tempPath, entry.path);
            entry.installed = true;
        }
        committed = true;
    } catch (error) {
        for (const entry of [...staged].reverse()) {
            try {
                if (entry.installed && fsOperations.existsSync(entry.path)) {
                    fsOperations.rmSync(entry.path, { force: true, recursive: true });
                }
                if (entry.hadOriginal && fsOperations.existsSync(entry.backupPath)) {
                    fsOperations.renameSync(entry.backupPath, entry.path);
                }
            } catch (_rollbackError) {
                // Keep the original failure; the finalizer removes remaining temporary files.
            }
        }
        throw error;
    } finally {
        for (const entry of staged) {
            const cleanupPaths = committed
                ? [entry.tempPath, entry.backupPath]
                : [entry.tempPath];
            for (const temporaryPath of cleanupPaths) {
                try {
                    if (fsOperations.existsSync(temporaryPath)) {
                        fsOperations.rmSync(temporaryPath, { force: true, recursive: true });
                    }
                } catch (_cleanupError) {
                    // Cleanup is best effort after the primary result is known.
                }
            }
        }
    }
}
