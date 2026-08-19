const assert = require("node:assert/strict");
const test = require("node:test");

const { isAcceptedSubmission, runSubmitWorkflow } = require("../../out-test/submissions/submitWorkflow.js");
const { correlateSubmission } = require("../../out-test/submissions/submissionCorrelation.js");

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
            createSourceSnapshot: async (filePath) => {
                calls.push(["snapshot", filePath]);
                return {
                    questionNumber: "42",
                    code: "return 42;",
                    filePath: "C:\\temp\\snapshot.ts",
                    dispose: async () => { calls.push(["cleanup"]); },
                };
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
            showCorrelationWarning: () => { calls.push(["warning"]); },
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
        "snapshot", "baseline", "submit", "correlate", "show", "sync", "cleanup", "refresh",
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

test("does not accept list metadata when validated detail has no status", () => {
    const submission = validatedSubmission();
    submission.submission.status_display = "Accepted";
    submission.detail.details = {};

    assert.equal(isAcceptedSubmission(submission), false);
});

test("an uncorrelated result is shown without context and never uploaded", async () => {
    const failure = new Error("submission-correlation-timeout:answer");
    const scenario = dependencies({ correlate: async () => { throw failure; } });

    await runSubmitWorkflow("answer.ts", scenario.dependencies);

    const shown = scenario.calls.find(([name]) => name === "show");
    assert.equal(shown[2], undefined);
    assert.strictEqual(scenario.calls.find(([name]) => name === "correlation-error")[1], failure);
    assert.equal(scenario.calls.some(([name]) => name === "warning"), true);
    assert.equal(scenario.calls.some(([name]) => name === "sync"), false);
    assert.deepEqual(scenario.calls.slice(-2).map(([name]) => name), ["cleanup", "refresh"]);
});

test("refreshes even when source capture or Notion sync fails", async () => {
    for (const overrides of [
        { createSourceSnapshot: async () => { throw new Error("bad source"); } },
        { syncToNotion: async () => { throw new Error("notion failed"); } },
    ]) {
        const scenario = dependencies(overrides);
        await assert.rejects(runSubmitWorkflow("answer.ts", scenario.dependencies));
        assert.equal(scenario.calls.at(-1)[0], "refresh");
    }
});

test("serializes concurrent identical-code submissions and uploads unique IDs", async () => {
    const visibleSubmissionIds = [];
    const baselineSnapshots = [];
    const uploadedSubmissionIds = [];
    let nextSubmissionId = 100;
    let activeSubmits = 0;
    let maximumActiveSubmits = 0;

    const sharedDependencies = {
        createSourceSnapshot: async (filePath) => ({
            questionNumber: "42",
            code: "return 42;",
            filePath: `snapshot-${filePath}`,
            dispose: async () => undefined,
        }),
        captureBaseline: async (questionNumber) => {
            baselineSnapshots.push([...visibleSubmissionIds]);
            return {
                questionNumber,
                expectedSlug: "answer",
                submissionIds: [...visibleSubmissionIds],
            };
        },
        submit: async () => {
            activeSubmits += 1;
            maximumActiveSubmits = Math.max(maximumActiveSubmits, activeSubmits);
            await new Promise((resolve) => setImmediate(resolve));
            const submissionId = ++nextSubmissionId;
            visibleSubmissionIds.push(submissionId);
            activeSubmits -= 1;
            return `submitted:${submissionId}`;
        },
        correlate: async (request) => {
            const baselineIds = new Set(request.submissionIds);
            const submissionId = visibleSubmissionIds.find((id) => !baselineIds.has(id));
            assert.notEqual(submissionId, undefined);
            const submission = validatedSubmission();
            submission.submission.id = submissionId;
            return submission;
        },
        showResult: () => undefined,
        shouldSyncToNotion: () => true,
        syncToNotion: async (submission) => {
            uploadedSubmissionIds.push(submission.submission.id);
        },
        refreshExplorer: () => undefined,
        reportCorrelationFailure: (error) => assert.fail(String(error)),
        showCorrelationWarning: () => assert.fail("correlation warning was unexpected"),
    };

    await Promise.all([
        runSubmitWorkflow("first.ts", sharedDependencies),
        runSubmitWorkflow("second.ts", sharedDependencies),
    ]);

    assert.equal(maximumActiveSubmits, 1);
    assert.deepEqual(baselineSnapshots, [[], [101]]);
    assert.deepEqual(uploadedSubmissionIds, [101, 102]);
    assert.equal(new Set(uploadedSubmissionIds).size, 2);
});

test("submits and correlates one immutable snapshot when the user file drifts", async () => {
    let userFileCode = "return 42;";
    let snapshotDeleted = false;
    const snapshotFilePath = "C:\\temp\\immutable.ts";
    const scenario = dependencies({
        createSourceSnapshot: async () => {
            const capturedCode = userFileCode;
            return {
                questionNumber: "42",
                code: capturedCode,
                filePath: snapshotFilePath,
                dispose: async () => { snapshotDeleted = true; },
            };
        },
        captureBaseline: async (questionNumber) => {
            userFileCode = "return 7;";
            return { questionNumber, expectedSlug: "answer", submissionIds: [] };
        },
        submit: async (submittedPath) => {
            assert.equal(submittedPath, snapshotFilePath);
            assert.equal(userFileCode, "return 7;");
            return "submitted";
        },
        correlate: async (request) => {
            assert.equal(request.submittedCode, "return 42;");
            return validatedSubmission();
        },
    });

    await runSubmitWorkflow("C:\\solutions\\answer.ts", scenario.dependencies);

    assert.equal(snapshotDeleted, true);
});

test("a deadline releases the question queue so the next submission proceeds", async () => {
    let correlationAttempt = 0;
    let listAborted = false;
    const uploadedSubmissionIds = [];
    const warnings = [];
    const sharedDependencies = {
        createSourceSnapshot: async (filePath) => ({
            questionNumber: "42",
            code: "return 42;",
            filePath: `snapshot-${filePath}`,
            dispose: async () => undefined,
        }),
        captureBaseline: async (questionNumber) => ({ questionNumber, expectedSlug: "answer", submissionIds: [] }),
        submit: async () => "submitted",
        correlate: async (request) => {
            correlationAttempt += 1;
            if (correlationAttempt === 1) {
                return correlateSubmission({ ...request, timeoutMs: 30, pollIntervalMs: 5 }, {
                    listProblemSubmissions: async (signal) => new Promise(() => {
                        signal.addEventListener("abort", () => { listAborted = true; });
                    }),
                    getSubmissionDetail: async () => assert.fail("detail should not be requested"),
                });
            }
            const submission = validatedSubmission();
            submission.submission.id = 102;
            return submission;
        },
        showResult: () => undefined,
        shouldSyncToNotion: () => true,
        syncToNotion: async (submission) => uploadedSubmissionIds.push(submission.submission.id),
        refreshExplorer: () => undefined,
        reportCorrelationFailure: () => undefined,
        showCorrelationWarning: () => {
            warnings.push("warning");
            return new Promise(() => undefined);
        },
    };

    await Promise.race([
        Promise.all([
            runSubmitWorkflow("first.ts", sharedDependencies),
            runSubmitWorkflow("second.ts", sharedDependencies),
        ]),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("queue did not release")), 500)),
    ]);

    assert.equal(listAborted, true);
    assert.equal(correlationAttempt, 2);
    assert.deepEqual(warnings, ["warning"]);
    assert.deepEqual(uploadedSubmissionIds, [102]);
});
