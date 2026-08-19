const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "..", "..");

async function modules() {
    const publication = await import(pathToFileURL(
        path.join(repositoryRoot, "scripts", "lib", "company-publication.mjs"),
    ));
    const validation = await import(pathToFileURL(
        path.join(repositoryRoot, "scripts", "lib", "data-validation.mjs"),
    ));
    return { publication, validation };
}

function dataset(revisionDigit, includeSecondQuestion) {
    const emptyDetails = {
        "Last 30 Days": ["1"],
        "Last 3 Months": includeSecondQuestion ? ["49"] : [],
        "Last 6 Months": [],
        "More Than 6 Months": [],
        "All Time": ["1"],
    };
    const companyTags = { Alpha: emptyDetails };
    const questionCompanyTags = includeSecondQuestion
        ? { "1": ["Alpha"], "49": ["Alpha"] }
        : { "1": ["Alpha"] };
    const provenance = {
        schemaVersion: 1,
        sourceRepository: "https://github.com/liquidslr/leetcode-company-wise-problems",
        sourceRevision: revisionDigit.repeat(40),
        generatedAt: "2026-08-19T00:00:00.000Z",
        counts: {
            companies: 1,
            questions: includeSecondQuestion ? 2 : 1,
            memberships: includeSecondQuestion ? 2 : 1,
        },
    };
    return { companyTags, questionCompanyTags, provenance };
}

test("every interrupted publication keeps the runtime bundle coherent and recovers all sidecars", async (t) => {
    const { publication, validation } = await modules();
    const checkpoints = [
        "journal-written",
        "bundle-published",
        "sidecar-companyTags-published",
        "sidecar-questionCompanyTags-published",
        "sidecar-provenance-published",
        "before-journal-delete",
    ];
    for (const checkpoint of checkpoints) {
        await t.test(checkpoint, () => {
            const outputDirectory = fs.mkdtempSync(path.join(tmpdir(), "company-publication-"));
            const oldDataset = dataset("1", false);
            const newDataset = dataset("2", true);
            const oldGeneration = publication.createCompanyGeneration(
                oldDataset.companyTags, oldDataset.questionCompanyTags, oldDataset.provenance,
            );
            const newGeneration = publication.createCompanyGeneration(
                newDataset.companyTags, newDataset.questionCompanyTags, newDataset.provenance,
            );
            try {
                publication.publishCompanyGeneration(outputDirectory, oldGeneration);
                assert.throws(() => publication.publishCompanyGeneration(outputDirectory, newGeneration, {
                    onCheckpoint: (reached) => {
                        if (reached === checkpoint) {
                            throw new Error(`simulated interruption at ${checkpoint}`);
                        }
                    },
                }), new RegExp(`simulated interruption at ${checkpoint}`));

                const bundle = JSON.parse(fs.readFileSync(
                    path.join(outputDirectory, publication.COMPANY_BUNDLE_FILE), "utf8",
                ));
                validation.validateCompanyDataset(
                    bundle.companyTags, bundle.questionCompanyTags, bundle.provenance,
                );
                assert.ok(
                    ["1".repeat(40), "2".repeat(40)].includes(bundle.provenance.sourceRevision),
                    "runtime bundle must be one complete old or new generation",
                );

                assert.equal(publication.recoverCompanyPublication(outputDirectory), true);
                const stats = publication.validatePublishedCompanyData(outputDirectory);
                assert.deepEqual(stats, {
                    companies: 1, questions: 2, memberships: 2, forwardGaps: 0, reverseGaps: 0,
                });
                const recoveredBundle = JSON.parse(fs.readFileSync(
                    path.join(outputDirectory, publication.COMPANY_BUNDLE_FILE), "utf8",
                ));
                assert.equal(recoveredBundle.provenance.sourceRevision, "2".repeat(40));
                assert.equal(
                    fs.existsSync(path.join(outputDirectory, publication.COMPANY_PUBLICATION_JOURNAL_FILE)),
                    false,
                );
            } finally {
                fs.rmSync(outputDirectory, { recursive: true, force: true });
            }
        });
    }
});

test("published-data validation rejects sidecars from a different generation", async () => {
    const { publication } = await modules();
    const outputDirectory = fs.mkdtempSync(path.join(tmpdir(), "company-sidecar-mismatch-"));
    const current = dataset("1", false);
    try {
        publication.publishCompanyGeneration(outputDirectory, publication.createCompanyGeneration(
            current.companyTags, current.questionCompanyTags, current.provenance,
        ));
        fs.writeFileSync(path.join(outputDirectory, "questionCompanyTags.json"), "{}\n");
        assert.throws(
            () => publication.validatePublishedCompanyData(outputDirectory),
            /compatibility sidecars do not match the authoritative bundle/,
        );
    } finally {
        fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
});

test("two interleaved publishers serialize journal ownership and finish on one generation", async () => {
    const { publication } = await modules();
    const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "company-concurrent-publication-"));
    const outputDirectory = path.join(temporaryRoot, "data");
    const firstGenerationPath = path.join(temporaryRoot, "first-generation.json");
    const secondGenerationPath = path.join(temporaryRoot, "second-generation.json");
    const firstStartedPath = path.join(temporaryRoot, "first-started");
    const firstReadyPath = path.join(temporaryRoot, "first-ready");
    const firstReleasePath = path.join(temporaryRoot, "first-release");
    const secondStartedPath = path.join(temporaryRoot, "second-started");
    const secondWaitingPath = path.join(temporaryRoot, "second-waiting");
    const publisherScript = path.join(
        repositoryRoot, "test", "fixtures", "company-publication", "publisher.mjs",
    );
    const firstDataset = dataset("1", false);
    const secondDataset = dataset("2", true);
    fs.writeFileSync(firstGenerationPath, JSON.stringify(publication.createCompanyGeneration(
        firstDataset.companyTags, firstDataset.questionCompanyTags, firstDataset.provenance,
    )));
    fs.writeFileSync(secondGenerationPath, JSON.stringify(publication.createCompanyGeneration(
        secondDataset.companyTags, secondDataset.questionCompanyTags, secondDataset.provenance,
    )));

    try {
        const first = spawnPublisher(publisherScript, [
            outputDirectory,
            firstGenerationPath,
            firstStartedPath,
            "journal-written",
            firstReadyPath,
            firstReleasePath,
            "-",
        ]);
        await waitForFile(firstReadyPath);
        const second = spawnPublisher(publisherScript, [
            outputDirectory,
            secondGenerationPath,
            secondStartedPath,
            "-",
            "-",
            "-",
            secondWaitingPath,
        ]);
        await waitForFile(secondStartedPath);
        await waitForFile(secondWaitingPath);
        assert.equal(
            fs.existsSync(path.join(outputDirectory, publication.COMPANY_PUBLICATION_LOCK_FILE)),
            true,
        );
        assert.equal(
            fs.existsSync(path.join(outputDirectory, publication.COMPANY_PUBLICATION_JOURNAL_FILE)),
            true,
        );

        fs.writeFileSync(firstReleasePath, "release\n");
        const [firstResult, secondResult] = await Promise.all([first.completed, second.completed]);
        assert.equal(firstResult.code, 0, firstResult.output);
        assert.equal(secondResult.code, 0, secondResult.output);

        const stats = publication.validatePublishedCompanyData(outputDirectory);
        assert.deepEqual(stats, {
            companies: 1, questions: 2, memberships: 2, forwardGaps: 0, reverseGaps: 0,
        });
        const bundle = JSON.parse(fs.readFileSync(
            path.join(outputDirectory, publication.COMPANY_BUNDLE_FILE), "utf8",
        ));
        assert.equal(bundle.provenance.sourceRevision, "2".repeat(40));
        assert.equal(
            fs.existsSync(path.join(outputDirectory, publication.COMPANY_PUBLICATION_JOURNAL_FILE)),
            false,
        );
        assert.equal(
            fs.existsSync(path.join(outputDirectory, publication.COMPANY_PUBLICATION_LOCK_FILE)),
            false,
        );
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test("publication lock records ownership and recovers a dead-owner lock", async () => {
    const { publication } = await modules();
    const outputDirectory = fs.mkdtempSync(path.join(tmpdir(), "company-stale-lock-"));
    const lockPath = path.join(outputDirectory, publication.COMPANY_PUBLICATION_LOCK_FILE);
    try {
        const lock = publication.acquirePublicationLock(outputDirectory, { waitTimeoutMs: 100 });
        const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        assert.equal(owner.pid, process.pid);
        assert.match(owner.token, /^[0-9a-f-]{36}$/);
        publication.releasePublicationLock(lock);
        assert.equal(fs.existsSync(lockPath), false);

        fs.writeFileSync(lockPath, JSON.stringify({
            schemaVersion: 1,
            token: "00000000-0000-4000-8000-000000000000",
            pid: 2_147_483_647,
            createdAt: "2020-01-01T00:00:00.000Z",
            processStartedAt: "2019-12-31T23:59:59.000Z",
        }));
        const old = new Date(Date.now() - 1_000);
        fs.utimesSync(lockPath, old, old);
        const recovered = publication.acquirePublicationLock(outputDirectory, {
            waitTimeoutMs: 100,
            staleLockMs: 50,
        });
        assert.equal(recovered.owner.pid, process.pid);
        publication.releasePublicationLock(recovered);
        assert.equal(fs.existsSync(lockPath), false);
    } finally {
        fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
});

test("stale malformed locks are restored for manual inspection instead of deleted", async () => {
    const { publication } = await modules();
    const outputDirectory = fs.mkdtempSync(path.join(tmpdir(), "company-malformed-lock-"));
    const lockPath = path.join(outputDirectory, publication.COMPANY_PUBLICATION_LOCK_FILE);
    try {
        fs.writeFileSync(lockPath, "partially-written-owner");
        const old = new Date(Date.now() - 1_000);
        fs.utimesSync(lockPath, old, old);
        assert.throws(
            () => publication.acquirePublicationLock(outputDirectory, {
                waitTimeoutMs: 100,
                staleLockMs: 50,
            }),
            /Cannot verify the quarantined publication-lock owner/,
        );
        assert.equal(fs.readFileSync(lockPath, "utf8"), "partially-written-owner");
        assert.deepEqual(
            fs.readdirSync(outputDirectory).filter((name) => name.includes(".quarantine-")),
            [],
        );
    } finally {
        fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
});

test("a fresh replacement installed before quarantine is restored without overwrite", async () => {
    const { publication } = await modules();
    const outputDirectory = fs.mkdtempSync(path.join(tmpdir(), "company-fresh-lock-"));
    const lockPath = path.join(outputDirectory, publication.COMPANY_PUBLICATION_LOCK_FILE);
    const old = new Date(Date.now() - 1_000);
    fs.writeFileSync(lockPath, JSON.stringify({
        schemaVersion: 1,
        token: "00000000-0000-4000-8000-000000000000",
        pid: 2_147_483_647,
        createdAt: old.toISOString(),
        processStartedAt: new Date(old.getTime() - 1_000).toISOString(),
    }));
    fs.utimesSync(lockPath, old, old);
    let replaced = false;
    try {
        assert.throws(() => publication.acquirePublicationLock(outputDirectory, {
            waitTimeoutMs: 75,
            pollIntervalMs: 5,
            staleLockMs: 50,
            onBeforeQuarantineRename: () => {
                if (replaced) { return; }
                replaced = true;
                const now = new Date();
                fs.writeFileSync(lockPath, JSON.stringify({
                    schemaVersion: 1,
                    token: "11111111-1111-4111-8111-111111111111",
                    pid: process.pid,
                    createdAt: now.toISOString(),
                    processStartedAt: new Date(Date.now() - process.uptime() * 1_000).toISOString(),
                }));
                fs.utimesSync(lockPath, now, now);
            },
        }), /Timed out waiting for company publication lock/);
        assert.match(fs.readFileSync(lockPath, "utf8"), /11111111-1111/);
        assert.deepEqual(
            fs.readdirSync(outputDirectory).filter((name) => name.includes(".quarantine-")),
            [],
        );
    } finally {
        fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
});

test("two children racing to recover one dead lock quarantine only the observed occupant", async () => {
    const { publication } = await modules();
    const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "company-quarantine-race-"));
    const outputDirectory = path.join(temporaryRoot, "data");
    fs.mkdirSync(outputDirectory);
    const lockPath = path.join(outputDirectory, publication.COMPANY_PUBLICATION_LOCK_FILE);
    const old = new Date(Date.now() - 2_000);
    fs.writeFileSync(lockPath, JSON.stringify({
        schemaVersion: 1,
        token: "00000000-0000-4000-8000-000000000000",
        pid: 2_147_483_647,
        createdAt: old.toISOString(),
        processStartedAt: new Date(old.getTime() - 1_000).toISOString(),
    }));
    fs.utimesSync(lockPath, old, old);
    const startPath = path.join(temporaryRoot, "start");
    const quarantineReleasePath = path.join(temporaryRoot, "quarantine-release");
    const criticalPath = path.join(temporaryRoot, "critical");
    const violationPath = path.join(temporaryRoot, "violation");
    const contenderScript = path.join(
        repositoryRoot, "test", "fixtures", "company-publication", "lock-contender.mjs",
    );
    const configs = ["first", "second"].map((name) => ({
        outputDirectory,
        readyPath: path.join(temporaryRoot, `${name}-ready`),
        startPath,
        staleLockMs: 50,
        quarantineReadyPath: path.join(temporaryRoot, `${name}-quarantine-ready`),
        quarantineReleasePath,
        criticalPath,
        violationPath,
        holdMs: 100,
    }));
    try {
        const contenders = configs.map((config) => spawnPublisher(contenderScript, [JSON.stringify(config)]));
        await Promise.all(configs.map((config) => waitForFile(config.readyPath)));
        fs.writeFileSync(startPath, "start\n");
        await Promise.all(configs.map((config) => waitForFile(config.quarantineReadyPath)));
        fs.writeFileSync(quarantineReleasePath, "release\n");
        const results = await Promise.all(contenders.map((contender) => contender.completed));
        for (const result of results) {
            assert.equal(result.code, 0, result.output);
        }
        assert.equal(fs.existsSync(violationPath), false, "two processes entered the critical section");
        assert.equal(fs.existsSync(lockPath), false);
        assert.deepEqual(
            fs.readdirSync(outputDirectory).filter((name) => name.includes(".quarantine-")),
            [],
        );
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test("a paused exclusive creator cannot be deleted or overtaken before writing its owner token", async () => {
    const { publication } = await modules();
    const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "company-paused-lock-"));
    const outputDirectory = path.join(temporaryRoot, "data");
    const startPath = path.join(temporaryRoot, "start");
    const exclusiveReleasePath = path.join(temporaryRoot, "exclusive-release");
    const criticalPath = path.join(temporaryRoot, "critical");
    const violationPath = path.join(temporaryRoot, "violation");
    const contenderScript = path.join(
        repositoryRoot, "test", "fixtures", "company-publication", "lock-contender.mjs",
    );
    const firstConfig = {
        outputDirectory,
        readyPath: path.join(temporaryRoot, "first-ready"),
        startPath,
        staleLockMs: 5_000,
        exclusiveReadyPath: path.join(temporaryRoot, "exclusive-ready"),
        exclusiveReleasePath,
        criticalPath,
        violationPath,
        holdMs: 100,
    };
    const secondConfig = {
        outputDirectory,
        readyPath: path.join(temporaryRoot, "second-ready"),
        startPath,
        staleLockMs: 5_000,
        waitingPath: path.join(temporaryRoot, "second-waiting"),
        criticalPath,
        violationPath,
        holdMs: 75,
    };
    try {
        const first = spawnPublisher(contenderScript, [JSON.stringify(firstConfig)]);
        await waitForFile(firstConfig.readyPath);
        fs.writeFileSync(startPath, "start\n");
        await waitForFile(firstConfig.exclusiveReadyPath);
        const second = spawnPublisher(contenderScript, [JSON.stringify(secondConfig)]);
        await waitForFile(secondConfig.readyPath);
        await waitForFile(secondConfig.waitingPath);

        const lockPath = path.join(outputDirectory, publication.COMPANY_PUBLICATION_LOCK_FILE);
        assert.equal(fs.statSync(lockPath).size, 0, "paused creator should still own its empty exclusive file");
        assert.deepEqual(
            fs.readdirSync(outputDirectory).filter((name) => name.includes(".quarantine-")),
            [],
        );
        fs.writeFileSync(exclusiveReleasePath, "release\n");
        const results = await Promise.all([first.completed, second.completed]);
        for (const result of results) {
            assert.equal(result.code, 0, result.output);
        }
        assert.equal(fs.existsSync(violationPath), false, "paused creator was overtaken");
        assert.equal(fs.existsSync(lockPath), false);
        assert.deepEqual(
            fs.readdirSync(outputDirectory).filter((name) => name.includes(".quarantine-")),
            [],
        );
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

function spawnPublisher(scriptPath, argumentsToPass) {
    const child = spawn(process.execPath, [scriptPath, ...argumentsToPass], {
        cwd: repositoryRoot,
        stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    const completed = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code, signal) => resolve({ code, signal, output }));
    });
    return { child, completed };
}

async function waitForFile(filePath) {
    const deadline = Date.now() + 5_000;
    while (!fs.existsSync(filePath)) {
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for ${filePath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
