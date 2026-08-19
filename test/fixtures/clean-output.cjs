const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

test("stale output was removed before the test process started", () => {
    const staleArtifact = process.env.LEETNOTION_TEST_STALE_ARTIFACT;
    assert.ok(staleArtifact, "expected a stale-artifact path from the harness regression");
    assert.equal(fs.existsSync(staleArtifact), false);
});
