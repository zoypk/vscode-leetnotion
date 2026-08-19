const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const runnerPath = path.join(repositoryRoot, "scripts", "run-tests.mjs");

test("discovers nested test files and excludes non-test fixtures", async () => {
    const { discoverTests } = await import(pathToFileURL(runnerPath).href);
    const discovered = await discoverTests();

    assert.ok(discovered.includes(__filename));
    assert.ok(discovered.every((file) => file.endsWith(".test.cjs")));
    assert.ok(!discovered.some((file) => file.includes(`${path.sep}fixtures${path.sep}`)));
});

test("propagates a failing test process exit code", () => {
    const fixturePath = path.join("test", "fixtures", "intentional-failure.cjs");
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [runnerPath, fixturePath], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: environment,
    });

    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /intentional failure fixture/);
});
