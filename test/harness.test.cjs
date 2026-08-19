const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const runnerPath = path.join(repositoryRoot, "scripts", "run-tests.mjs");

function runHarness(argumentsToPass) {
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, [runnerPath, ...argumentsToPass], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: environment,
    });
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

test("removes stale compiler output before emitting", () => {
    const staleArtifact = path.join(repositoryRoot, "out-test", "stale-artifact.js");
    fs.mkdirSync(path.dirname(staleArtifact), { recursive: true });
    fs.writeFileSync(staleArtifact, "stale", "utf8");

    const result = runHarness([path.join("test", "fixtures", "passing.cjs")]);

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
