const assert = require("node:assert/strict");
const test = require("node:test");

const { completeSubmissionSync } = require("../../out-test/notion/submissionSyncWorkflow.js");

test("stale panel attachment never aborts post-create code upload", async () => {
    const calls = [];
    await completeSubmissionSync({
        attachPanel: async () => { calls.push("panel"); throw new Error("stale-submission-panel-context"); },
        addCode: async () => calls.push("code"),
        reportPanelError: (error) => calls.push(error.message),
    });
    assert.deepEqual(calls, ["panel", "stale-submission-panel-context", "code"]);
});

test("a false panel attachment still continues code upload", async () => {
    const calls = [];
    await completeSubmissionSync({
        attachPanel: async () => false,
        addCode: async () => calls.push("code"),
        reportPanelError: () => assert.fail("no exception expected"),
    });
    assert.deepEqual(calls, ["code"]);
});
