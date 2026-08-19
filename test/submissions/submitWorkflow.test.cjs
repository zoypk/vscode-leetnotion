const assert = require("node:assert/strict");
const test = require("node:test");

const { isAcceptedSubmission, runSubmitWorkflow } = require("../../out-test/submissions/submitWorkflow.js");

function validatedSubmission(status = "Accepted") {
    return {
        questionNumber: "42",
        submission: {
            id: 99,
            title: "Answer",
            title_slug: "answer",
            status_display: "Misleading CLI value",
            code: "return 42;",
            timestamp: 100,
            lang: "typescript",
        },
        detail: {
            code: "return 42;",
            notes: "",
            flag_type: "WHITE",
            runtime_percentile: null,
            memory_percentile: null,
            details: { status_msg: status, compare_result: status },
        },
    };
}

function dependencies(overrides = {}) {
    const calls = [];
    const validated = validatedSubmission();
    return {
        calls,
        validated,
        dependencies: {
            readSource: async (filePath) => {
                calls.push(["read", filePath]);
                return { questionNumber: "42", code: "return 42;" };
            },
            captureBaseline: async (questionNumber) => {
                calls.push(["baseline", questionNumber]);
                return { questionNumber, expectedSlug: "answer", submissionIds: [1, 2] };
            },
            submit: async (filePath) => {
                calls.push(["submit", filePath]);
                return "CLI output without an acceptance keyword";
            },
            correlate: async (request) => {
                calls.push(["correlate", request]);
                return validated;
            },
            showResult: (result, submission) => calls.push(["show", result, submission]),
            shouldSyncToNotion: () => true,
            syncToNotion: async (submission) => { calls.push(["sync", submission]); },
            refreshExplorer: () => { calls.push(["refresh"]); },
            reportCorrelationFailure: (error) => calls.push(["correlation-error", error]),
            now: () => 123_456,
            ...overrides,
        },
    };
}

test("passes the same validated submission object to the view and Notion", async () => {
    const scenario = dependencies();

    await runSubmitWorkflow("C:\\solutions\\custom.ts", scenario.dependencies);

    const shown = scenario.calls.find(([name]) => name === "show");
    const synced = scenario.calls.find(([name]) => name === "sync");
    const correlation = scenario.calls.find(([name]) => name === "correlate")[1];
    assert.strictEqual(shown[2], scenario.validated);
    assert.strictEqual(synced[1], scenario.validated);
    assert.deepEqual(correlation, {
        questionNumber: "42",
        expectedSlug: "answer",
        submissionIds: [1, 2],
        submittedCode: "return 42;",
        startedAtMs: 123_456,
    });
    assert.deepEqual(scenario.calls.map(([name]) => name), [
        "read", "baseline", "submit", "correlate", "show", "sync", "refresh",
    ]);
});

test("derives acceptance from validated detail rather than CLI output", async () => {
    const rejected = validatedSubmission("Wrong Answer");
    const scenario = dependencies({ correlate: async () => rejected });

    await runSubmitWorkflow("answer.ts", scenario.dependencies);

    assert.equal(isAcceptedSubmission(rejected), false);
    assert.equal(scenario.calls.some(([name]) => name === "sync"), false);
    assert.equal(scenario.calls.some(([name]) => name === "refresh"), true);
});

test("an uncorrelated result is shown without context and never uploaded", async () => {
    const failure = new Error("submission-correlation-timeout:answer");
    const scenario = dependencies({ correlate: async () => { throw failure; } });

    await runSubmitWorkflow("answer.ts", scenario.dependencies);

    const shown = scenario.calls.find(([name]) => name === "show");
    assert.equal(shown[2], undefined);
    assert.strictEqual(scenario.calls.find(([name]) => name === "correlation-error")[1], failure);
    assert.equal(scenario.calls.some(([name]) => name === "sync"), false);
    assert.equal(scenario.calls.at(-1)[0], "refresh");
});

test("refreshes even when source capture or Notion sync fails", async () => {
    for (const overrides of [
        { readSource: async () => { throw new Error("bad source"); } },
        { syncToNotion: async () => { throw new Error("notion failed"); } },
    ]) {
        const scenario = dependencies(overrides);
        await assert.rejects(runSubmitWorkflow("answer.ts", scenario.dependencies));
        assert.equal(scenario.calls.at(-1)[0], "refresh");
    }
});
