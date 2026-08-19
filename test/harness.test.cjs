const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const runnerPath = path.join(repositoryRoot, "scripts", "run-tests.mjs");

function runHarness(argumentsToPass, environmentOverrides = {}) {
    const environment = { ...process.env, ...environmentOverrides };
    delete environment.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, [runnerPath, ...argumentsToPass], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: environment,
    });
}

function runHarnessAsync(argumentsToPass, environmentOverrides = {}) {
    const environment = { ...process.env, ...environmentOverrides };
    delete environment.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [runnerPath, ...argumentsToPass], {
        cwd: repositoryRoot,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const completed = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error(`Nested harness did not exit within 60 seconds: ${stdout}\n${stderr}`));
        }, 60_000);
        child.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once("close", (status, signal) => {
            clearTimeout(timeout);
            resolve({ status, signal, stdout, stderr });
        });
    });
    return { child, completed };
}

test("discovers nested test files and excludes non-test fixtures", async () => {
    const { discoverTests, normalizeTestArguments } = await import(pathToFileURL(runnerPath).href);
    const discovered = await discoverTests();

    assert.ok(discovered.includes(__filename));
    assert.ok(discovered.every((file) => file.endsWith(".test.cjs")));
    assert.ok(!discovered.some((file) => file.includes(`${path.sep}fixtures${path.sep}`)));
    assert.deepEqual(
        normalizeTestArguments(["test/one.test.cjs", "--test-name-pattern", "selected"]),
        { runnerOptions: ["--test-name-pattern", "selected"], testFiles: ["test/one.test.cjs"] },
    );
    assert.throws(
        () => normalizeTestArguments(["--watch"]),
        /Unsupported test runner option: --watch/,
    );
});

test("propagates a failing test process exit code", () => {
    const fixturePath = path.join("test", "fixtures", "intentional-failure.cjs");
    const result = runHarness([fixturePath]);

    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /intentional failure fixture/);
});

test("a nested harness run cannot remove compiled output used by its parent", async () => {
    const compiledModule = path.join(repositoryRoot, "out-test", "utils", "toolUtils.js");
    const parentSentinel = path.join(repositoryRoot, "out-test", `.parent-${process.pid}.sentinel`);
    assert.equal(fs.existsSync(compiledModule), true, "parent compilation must exist before overlap");
    fs.writeFileSync(parentSentinel, "owned by the parent test run", "utf8");

    try {
        const nested = runHarnessAsync([path.join("test", "fixtures", "passing.cjs")]);
        const result = await nested.completed;

        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.equal(fs.existsSync(parentSentinel), true, "nested cleanup removed the parent output");
        assert.equal(fs.existsSync(compiledModule), true, "nested cleanup removed the parent compiled module");
        delete require.cache[compiledModule];
        try {
            require(compiledModule);
        } catch (error) {
            assert.fail(`nested cleanup interrupted a parent compiled import: ${error}`);
        }
    } finally {
        fs.rmSync(parentSentinel, { force: true });
    }
});

test("a stale output lock fails promptly with manual recovery details", () => {
    const isolatedOutput = path.join(repositoryRoot, "out-test", `.stale-lock-${process.pid}`);
    const lockPath = `${isolatedOutput}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }), "utf8");

    const startedAt = Date.now();
    try {
        const result = runHarness(
            [path.join("test", "fixtures", "passing.cjs")],
            { LEETNOTION_TEST_OUTPUT_ROOT: isolatedOutput },
        );

        assert.notEqual(result.status, 0);
        assert.ok(Date.now() - startedAt < 5_000, "stale lock should fail without the live-owner wait");
        assert.match(`${result.stdout}\n${result.stderr}`, /lock is stale/i);
        assert.match(`${result.stdout}\n${result.stderr}`, /owner PID 2147483647/);
        assert.match(`${result.stdout}\n${result.stderr}`, /Remove this lock manually/);
        assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(lockPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
        fs.rmSync(lockPath, { force: true });
    }
});

test("removes stale compiler output before emitting", () => {
    const isolatedOutput = path.join(
        repositoryRoot,
        "out-test",
        `.stale-output-${process.pid}-${Date.now()}`,
    );
    const staleArtifact = path.join(isolatedOutput, "stale-artifact.js");
    fs.mkdirSync(path.dirname(staleArtifact), { recursive: true });
    fs.writeFileSync(staleArtifact, "stale", "utf8");

    const result = runHarness(
        [path.join("test", "fixtures", "clean-output.cjs")],
        {
            LEETNOTION_TEST_OUTPUT_ROOT: isolatedOutput,
            LEETNOTION_TEST_STALE_ARTIFACT: staleArtifact,
        },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(staleArtifact), false);
});

test("normalizes supported options placed after test files", () => {
    const fixturePath = path.join("test", "fixtures", "pattern-selection.cjs");
    const result = runHarness([
        fixturePath,
        "--test-name-pattern",
        "^selected passing fixture$",
    ]);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /selected passing fixture/);
    assert.doesNotMatch(result.stdout, /the name pattern should skip this failure/);
});
