import {
    closeSync,
    existsSync,
    fstatSync,
    fsyncSync,
    linkSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateCompanyDataset } from "./data-validation.mjs";
import { atomicReplaceFile } from "./sync-utils.mjs";

export const COMPANY_BUNDLE_FILE = "company-data.json";
export const COMPANY_PUBLICATION_JOURNAL_FILE = ".company-data-publication.json";
export const COMPANY_PUBLICATION_LOCK_FILE = ".company-data-publication.lock";

const DEFAULT_LOCK_WAIT_MS = 30_000;
const DEFAULT_LOCK_POLL_MS = 25;
const DEFAULT_LOCK_STALE_MS = 30_000;
const lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));
const processStartedAtMs = Date.now() - process.uptime() * 1_000;

const SIDECAR_FILES = Object.freeze({
    companyTags: "companyTags.json",
    questionCompanyTags: "questionCompanyTags.json",
    provenance: "company-data-provenance.json",
});

export function createCompanyGeneration(companyTags, questionCompanyTags, provenance) {
    return {
        bundle: `${JSON.stringify({
            schemaVersion: 1,
            companyTags,
            questionCompanyTags,
            provenance,
        })}\n`,
        companyTags: `${JSON.stringify(companyTags)}\n`,
        questionCompanyTags: `${JSON.stringify(questionCompanyTags)}\n`,
        provenance: `${JSON.stringify(provenance, null, 2)}\n`,
    };
}

export function validateCompanyGeneration(generation, validationOptions = {}) {
    if (!generation || typeof generation !== "object") {
        throw new Error("Company publication generation is missing");
    }
    const expectedKeys = ["bundle", "companyTags", "provenance", "questionCompanyTags"];
    if (Object.keys(generation).sort().join(",") !== expectedKeys.join(",")
        || expectedKeys.some((key) => typeof generation[key] !== "string")) {
        throw new Error("Company publication generation has an invalid shape");
    }
    const bundle = parseJson(generation.bundle, COMPANY_BUNDLE_FILE);
    const companyTags = parseJson(generation.companyTags, SIDECAR_FILES.companyTags);
    const questionCompanyTags = parseJson(
        generation.questionCompanyTags,
        SIDECAR_FILES.questionCompanyTags,
    );
    const provenance = parseJson(generation.provenance, SIDECAR_FILES.provenance);
    if (!bundle || bundle.schemaVersion !== 1) {
        throw new Error("Company data bundle must use schema version 1");
    }
    if (!jsonEqual(bundle.companyTags, companyTags)
        || !jsonEqual(bundle.questionCompanyTags, questionCompanyTags)
        || !jsonEqual(bundle.provenance, provenance)) {
        throw new Error("Company compatibility sidecars do not match the authoritative bundle");
    }
    return validateCompanyDataset(
        bundle.companyTags,
        bundle.questionCompanyTags,
        bundle.provenance,
        validationOptions,
    );
}

export function publishCompanyGeneration(outputDirectory, generation, options = {}) {
    return withPublicationLock(outputDirectory, options.lockOptions, () => {
        recoverCompanyPublicationUnlocked(outputDirectory, options);
        validateCompanyGeneration(generation, options.validationOptions);
        const journalPath = join(outputDirectory, COMPANY_PUBLICATION_JOURNAL_FILE);
        const journal = `${JSON.stringify({ schemaVersion: 1, generation })}\n`;
        atomicReplaceFile(journalPath, journal, {
            validate: (stagedPath) => parseJournal(readFileSync(stagedPath, "utf8"), options),
        });
        options.onCheckpoint?.("journal-written");

        installGeneration(outputDirectory, generation, options);
        options.onCheckpoint?.("before-journal-delete");
        rmSync(journalPath, { force: true });
    });
}

export function recoverCompanyPublication(outputDirectory, options = {}) {
    return withPublicationLock(
        outputDirectory,
        options.lockOptions,
        () => recoverCompanyPublicationUnlocked(outputDirectory, options),
    );
}

function recoverCompanyPublicationUnlocked(outputDirectory, options = {}) {
    const journalPath = join(outputDirectory, COMPANY_PUBLICATION_JOURNAL_FILE);
    if (!existsSync(journalPath)) {
        return false;
    }
    const journal = parseJournal(readFileSync(journalPath, "utf8"), options);
    installGeneration(outputDirectory, journal.generation, {
        validationOptions: options.validationOptions,
    });
    rmSync(journalPath, { force: true });
    return true;
}

export function validatePublishedCompanyData(outputDirectory, validationOptions = {}) {
    return withPublicationLock(outputDirectory, undefined, () => {
        const journalPath = join(outputDirectory, COMPANY_PUBLICATION_JOURNAL_FILE);
        if (existsSync(journalPath)) {
            throw new Error(
                `Company data has an unfinished publication journal at ${journalPath}; run the company sync to recover it`,
            );
        }
        const paths = publicationPaths(outputDirectory);
        const generation = {
            bundle: readFileSync(paths.bundle, "utf8"),
            companyTags: readFileSync(paths.companyTags, "utf8"),
            questionCompanyTags: readFileSync(paths.questionCompanyTags, "utf8"),
            provenance: readFileSync(paths.provenance, "utf8"),
        };
        return validateCompanyGeneration(generation, validationOptions);
    });
}

export function withPublicationLock(outputDirectory, lockOptions = {}, operation) {
    const lock = acquirePublicationLock(outputDirectory, lockOptions);
    try {
        return operation();
    } finally {
        releasePublicationLock(lock);
    }
}

export function acquirePublicationLock(outputDirectory, options = {}) {
    mkdirSync(outputDirectory, { recursive: true });
    const lockPath = join(outputDirectory, COMPANY_PUBLICATION_LOCK_FILE);
    const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_LOCK_WAIT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_LOCK_POLL_MS;
    const staleLockMs = options.staleLockMs ?? DEFAULT_LOCK_STALE_MS;
    const deadline = Date.now() + waitTimeoutMs;
    let quarantineDeferred = false;
    while (true) {
        const owner = {
            schemaVersion: 1,
            token: randomUUID(),
            pid: process.pid,
            createdAt: new Date().toISOString(),
            processStartedAt: new Date(processStartedAtMs).toISOString(),
        };
        let fileDescriptor;
        let openedStats;
        try {
            fileDescriptor = openSync(lockPath, "wx");
            openedStats = fstatSync(fileDescriptor);
            options.onExclusiveCreate?.(lockPath);
            writeFileSync(fileDescriptor, `${JSON.stringify(owner)}\n`, "utf8");
            fsyncSync(fileDescriptor);
            if (readLockOwner(lockPath)?.token !== owner.token) {
                throw new Error(`Lost company publication lock during setup: ${lockPath}`);
            }
            return { fileDescriptor, lockPath, owner };
        } catch (error) {
            if (fileDescriptor !== undefined) {
                try { closeSync(fileDescriptor); } catch (_closeError) { /* best effort */ }
                if (openedStats) {
                    removeCreatedLockIfSameFile(lockPath, openedStats);
                } else {
                    try { rmSync(lockPath, { force: true }); } catch (_removeError) { /* best effort */ }
                }
            }
            if (error.code !== "EEXIST") {
                throw error;
            }
            if (!quarantineDeferred) {
                const quarantine = quarantineStaleCandidate(lockPath, staleLockMs, options);
                if (quarantine.status === "recovered") {
                    continue;
                }
                if (quarantine.status === "unsafe") {
                    throw new Error(quarantine.message);
                }
                quarantineDeferred = true;
            }
            if (Date.now() >= deadline) {
                throw new Error(`Timed out waiting for company publication lock: ${lockPath}`);
            }
            options.onWait?.(readLockOwner(lockPath));
            Atomics.wait(lockWaitBuffer, 0, 0, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
        }
    }
}

export function releasePublicationLock(lock) {
    try { closeSync(lock.fileDescriptor); } catch (_closeError) { /* best effort */ }
    const quarantinePath = `${lock.lockPath}.quarantine-release-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
        renameSync(lock.lockPath, quarantinePath);
    } catch (error) {
        if (error.code !== "ENOENT") {
            // A stale lock is recoverable by the next publisher after this process exits.
        }
        return;
    }
    const quarantinedOwner = readLockOwner(quarantinePath);
    if (quarantinedOwner?.token === lock.owner.token) {
        rmSync(quarantinePath, { force: true });
        return;
    }
    try {
        restoreQuarantinedLock(
            lock.lockPath,
            quarantinePath,
            "Release quarantined a lock owned by a different publication process",
            true,
        );
    } catch (_error) {
        // Never delete an occupant whose fencing token does not match this owner.
    }
}

function installGeneration(outputDirectory, generation, options) {
    validateCompanyGeneration(generation, options.validationOptions);
    const paths = publicationPaths(outputDirectory);
    atomicReplaceFile(paths.bundle, generation.bundle);
    options.onCheckpoint?.("bundle-published");
    for (const sidecarName of Object.keys(SIDECAR_FILES)) {
        atomicReplaceFile(paths[sidecarName], generation[sidecarName]);
        options.onCheckpoint?.(`sidecar-${sidecarName}-published`);
    }
}

function parseJournal(rawJournal, options) {
    const journal = parseJson(rawJournal, COMPANY_PUBLICATION_JOURNAL_FILE);
    if (!journal || journal.schemaVersion !== 1) {
        throw new Error("Company publication journal must use schema version 1");
    }
    validateCompanyGeneration(journal.generation, options.validationOptions);
    return journal;
}

function publicationPaths(outputDirectory) {
    return {
        bundle: join(outputDirectory, COMPANY_BUNDLE_FILE),
        companyTags: join(outputDirectory, SIDECAR_FILES.companyTags),
        questionCompanyTags: join(outputDirectory, SIDECAR_FILES.questionCompanyTags),
        provenance: join(outputDirectory, SIDECAR_FILES.provenance),
    };
}

function parseJson(raw, description) {
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Could not parse ${description}: ${error.message}`);
    }
}

function jsonEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function readLockOwner(lockPath) {
    try {
        const owner = JSON.parse(readFileSync(lockPath, "utf8"));
        return owner
            && owner.schemaVersion === 1
            && typeof owner.token === "string"
            && Number.isSafeInteger(owner.pid)
            && owner.pid > 0
            && typeof owner.createdAt === "string"
            && Number.isFinite(Date.parse(owner.createdAt))
            && typeof owner.processStartedAt === "string"
            && Number.isFinite(Date.parse(owner.processStartedAt))
            && Date.parse(owner.processStartedAt) <= Date.parse(owner.createdAt)
            ? owner
            : undefined;
    } catch (_error) {
        return undefined;
    }
}

function quarantineStaleCandidate(lockPath, staleLockMs, options) {
    if (!isLockStale(lockPath, staleLockMs)) {
        return { status: "busy" };
    }
    options.onBeforeQuarantineRename?.(lockPath);
    const quarantinePath = `${lockPath}.quarantine-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
        renameSync(lockPath, quarantinePath);
    } catch (error) {
        if (error.code === "ENOENT") {
            return { status: "recovered" };
        }
        throw error;
    }
    try {
        options.onLockQuarantined?.(quarantinePath);
        if (!isLockStale(quarantinePath, staleLockMs)) {
            return restoreQuarantinedLock(
                lockPath,
                quarantinePath,
                "A fresh company publication lock was replaced immediately before quarantine",
            );
        }
        const owner = readLockOwner(quarantinePath);
        if (!owner) {
            return restoreQuarantinedLock(
                lockPath,
                quarantinePath,
                `Cannot verify the quarantined publication-lock owner; manually inspect ${lockPath}`,
                true,
            );
        }
        const liveness = getLockOwnerLiveness(owner);
        if (liveness === "dead") {
            rmSync(quarantinePath, { force: true });
            return { status: "recovered" };
        }
        if (liveness === "unknown") {
            return restoreQuarantinedLock(
                lockPath,
                quarantinePath,
                `Cannot safely verify whether PID ${owner.pid} still owns the company publication lock`,
                true,
            );
        }
        return restoreQuarantinedLock(
            lockPath,
            quarantinePath,
            "The stale-looking company publication lock owner is still alive",
        );
    } catch (error) {
        try { restoreQuarantinedLock(lockPath, quarantinePath, String(error)); } catch (_restoreError) { /* best effort */ }
        throw error;
    }
}

function restoreQuarantinedLock(lockPath, quarantinePath, reason, unsafe = false) {
    try {
        linkSync(quarantinePath, lockPath);
        rmSync(quarantinePath, { force: true });
        return unsafe ? { status: "unsafe", message: reason } : { status: "busy" };
    } catch (error) {
        if (error.code === "EEXIST") {
            return {
                status: "unsafe",
                message: `${reason}. A new owner claimed ${lockPath}; prior lock remains at ${quarantinePath}`,
            };
        }
        if (error.code === "ENOENT") {
            return { status: "busy" };
        }
        throw error;
    }
}

function isLockStale(lockPath, staleLockMs) {
    try {
        return Date.now() - statSync(lockPath).mtimeMs > staleLockMs;
    } catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

function getLockOwnerLiveness(owner) {
    if (owner.pid === process.pid) {
        return Math.abs(Date.parse(owner.processStartedAt) - processStartedAtMs) < 5_000
            ? "alive"
            : "dead";
    }
    try {
        process.kill(owner.pid, 0);
        return "unknown";
    } catch (error) {
        return error.code === "ESRCH" ? "dead" : "unknown";
    }
}

function removeCreatedLockIfSameFile(lockPath, openedStats) {
    if (!openedStats) {
        return;
    }
    try {
        const currentStats = statSync(lockPath);
        const sameFile = currentStats.dev === openedStats.dev
            && currentStats.ino === openedStats.ino
            && currentStats.birthtimeMs === openedStats.birthtimeMs;
        if (sameFile) {
            rmSync(lockPath, { force: true });
        }
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }
}
