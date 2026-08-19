import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { publishCompanyGeneration } from "../../../scripts/lib/company-publication.mjs";

const [
    outputDirectory,
    generationPath,
    startedPath,
    holdCheckpoint,
    readyPath,
    releasePath,
    waitingPath,
] = process.argv.slice(2);

const generation = JSON.parse(readFileSync(generationPath, "utf8"));
if (startedPath !== "-") {
    writeFileSync(startedPath, "started\n");
}

publishCompanyGeneration(outputDirectory, generation, {
    lockOptions: {
        onWait: () => {
            if (waitingPath !== "-" && !existsSync(waitingPath)) {
                writeFileSync(waitingPath, "waiting\n");
            }
        },
    },
    onCheckpoint: (checkpoint) => {
        if (checkpoint !== holdCheckpoint) {
            return;
        }
        writeFileSync(readyPath, `${checkpoint}\n`);
        const deadline = Date.now() + 10_000;
        const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync(releasePath)) {
            if (Date.now() >= deadline) {
                throw new Error(`Timed out waiting for test release at ${checkpoint}`);
            }
            Atomics.wait(waitBuffer, 0, 0, 10);
        }
    },
});
