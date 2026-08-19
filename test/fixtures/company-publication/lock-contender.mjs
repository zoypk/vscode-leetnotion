import {
    closeSync,
    existsSync,
    openSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import {
    acquirePublicationLock,
    releasePublicationLock,
} from "../../../scripts/lib/company-publication.mjs";

const config = JSON.parse(process.argv[2]);
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function signal(filePath, value = "ready\n") {
    if (filePath && filePath !== "-") {
        writeFileSync(filePath, value);
    }
}

function waitFor(filePath) {
    if (!filePath || filePath === "-") {
        return;
    }
    const deadline = Date.now() + 10_000;
    while (!existsSync(filePath)) {
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for ${filePath}`);
        }
        Atomics.wait(waitBuffer, 0, 0, 10);
    }
}

signal(config.readyPath);
waitFor(config.startPath);
const lock = acquirePublicationLock(config.outputDirectory, {
    waitTimeoutMs: 10_000,
    onExclusiveCreate: () => {
        signal(config.exclusiveReadyPath);
        waitFor(config.exclusiveReleasePath);
    },
    onWait: () => signal(config.waitingPath),
});

let criticalFileDescriptor;
try {
    try {
        criticalFileDescriptor = openSync(config.criticalPath, "wx");
    } catch (error) {
        if (error.code !== "EEXIST") {
            throw error;
        }
        signal(config.violationPath, "overlap\n");
    }
    signal(config.acquiredPath);
    Atomics.wait(waitBuffer, 0, 0, config.holdMs ?? 75);
} finally {
    if (criticalFileDescriptor !== undefined) {
        closeSync(criticalFileDescriptor);
        rmSync(config.criticalPath, { force: true });
    }
    releasePublicationLock(lock);
}
