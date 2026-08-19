const assert = require("node:assert/strict");
const test = require("node:test");

const {
    correlateSubmission,
    extractSubmissionSource,
    normalizeSubmissionCode,
} = require("../../out-test/submissions/submissionCorrelation.js");

function submission(overrides) {
    return {
        code: "",
        compare_result: "",
        flag_type: 0,
        has_notes: false,
        id: 1,
        is_pending: "false",
        lang: "typescript",
        lang_name: "TypeScript",
        memory: "10 MB",
        question_id: 42,
        runtime: "50 ms",
        status: 10,
        status_display: "Accepted",
        time: "",
        timestamp: 100,
        title: "Answer",
        title_slug: "answer",
        url: "https://leetcode.com/submissions/detail/1/",
        ...overrides,
    };
}

function detail(code, status = "Accepted") {
    return {
        code,
        runtime_percentile: 90,
        memory_percentile: 80,
        notes: "",
        flag_type: "WHITE",
        details: { compare_result: status, status_msg: status },
    };
}

test("extracts marker identity and only the submitted code block", () => {
    const source = [
        "// user header",
        "// @lc app=leetcode id=42 lang=typescript",
        "// @lc code=start",
        "function answer() {  ",
        "  return 42;",
        "}",
        "// @lc code=end",
        "// user footer",
    ].join("\r\n");

    assert.deepEqual(extractSubmissionSource("C:\\solutions\\custom.ts", source), {
        questionNumber: "42",
        code: "function answer() {  \n  return 42;\n}",
    });
    assert.equal(normalizeSubmissionCode("\uFEFFa();  \r\n"), "a();  \n");
});

test("rejects baseline, stale, other-problem, and different-code submissions", async () => {
    let currentTime = 105_000;
    const detailRequests = [];
    const submissions = [
        submission({ id: 1, timestamp: 105, title_slug: "answer" }),
        submission({ id: 2, timestamp: 90, title_slug: "answer" }),
        submission({ id: 3, timestamp: 105, title_slug: "other" }),
        submission({ id: 4, timestamp: 107, title_slug: "answer" }),
        submission({ id: 5, timestamp: 106, title_slug: "answer" }),
    ];

    const result = await correlateSubmission({
        questionNumber: "42",
        expectedSlug: "answer",
        submissionIds: [1],
        submittedCode: "return 42;",
        startedAtMs: 104_000,
        timeoutMs: 1_000,
        pollIntervalMs: 10,
        clockSkewMs: 0,
    }, {
        listProblemSubmissions: async () => submissions,
        getSubmissionDetail: async (id) => {
            detailRequests.push(id);
            return detail(id === 5 ? "return 42;" : "return 7;");
        },
        now: () => currentTime,
        sleep: async (ms) => { currentTime += ms; },
    });

    assert.equal(result.submission.id, 5);
    assert.equal(result.submission.code, "return 42;");
    assert.equal(result.detail.details.status_msg, "Accepted");
    assert.deepEqual(detailRequests, [4, 5]);
});

test("times out with useful rejection diagnostics instead of guessing", async () => {
    let currentTime = 200_000;

    await assert.rejects(
        correlateSubmission({
            questionNumber: "42",
            expectedSlug: "answer",
            submissionIds: [],
            submittedCode: "correct();",
            startedAtMs: 199_000,
            timeoutMs: 20,
            pollIntervalMs: 10,
            clockSkewMs: 0,
        }, {
            listProblemSubmissions: async () => [submission({ id: 9, timestamp: 200 })],
            getSubmissionDetail: async () => detail("wrong();"),
            now: () => currentTime,
            sleep: async (ms) => { currentTime += ms; },
        }),
        /submission-correlation-timeout:answer.*9:code-mismatch/,
    );
});

test("retries transient list and detail failures until the exact submission is available", async () => {
    let currentTime = 300_000;
    let listAttempts = 0;
    let detailAttempts = 0;

    const result = await correlateSubmission({
        questionNumber: "42",
        expectedSlug: "answer",
        submissionIds: [],
        submittedCode: "correct();",
        startedAtMs: 299_000,
        timeoutMs: 50,
        pollIntervalMs: 10,
        clockSkewMs: 0,
    }, {
        listProblemSubmissions: async () => {
            listAttempts += 1;
            if (listAttempts === 1) {
                throw new Error("temporary API failure");
            }
            return [submission({ id: 10, timestamp: 300 })];
        },
        getSubmissionDetail: async () => {
            detailAttempts += 1;
            if (detailAttempts === 1) {
                throw new Error("detail not propagated yet");
            }
            return detail("correct();");
        },
        now: () => currentTime,
        sleep: async (ms) => { currentTime += ms; },
    });

    assert.equal(result.submission.id, 10);
    assert.equal(listAttempts, 3);
    assert.equal(detailAttempts, 2);
});

test("waits for matching code to reach an authoritative terminal status", async () => {
    let currentTime = 400_000;
    let detailAttempts = 0;

    const result = await correlateSubmission({
        questionNumber: "42",
        expectedSlug: "answer",
        submissionIds: [],
        submittedCode: "correct();",
        startedAtMs: 399_000,
        timeoutMs: 50,
        pollIntervalMs: 10,
        clockSkewMs: 0,
    }, {
        listProblemSubmissions: async () => [submission({ id: 11, timestamp: 400 })],
        getSubmissionDetail: async () => {
            detailAttempts += 1;
            const status = detailAttempts === 1 ? null : detailAttempts === 2 ? "Pending" : "Accepted";
            return detail("correct();", status);
        },
        now: () => currentTime,
        sleep: async (ms) => { currentTime += ms; },
    });

    assert.equal(detailAttempts, 3);
    assert.equal(result.detail.details.status_msg, "Accepted");
});

test("bounds never-settling list and detail requests by the overall deadline", async () => {
    for (const stalledOperation of ["list", "detail"]) {
        let aborted = false;
        const startedAt = Date.now();
        await assert.rejects(
            correlateSubmission({
                questionNumber: "42",
                expectedSlug: "answer",
                submissionIds: [],
                submittedCode: "correct();",
                startedAtMs: startedAt - 1_000,
                timeoutMs: 30,
                pollIntervalMs: 5,
                clockSkewMs: 0,
            }, {
                listProblemSubmissions: stalledOperation === "list"
                    ? async (signal) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; }))
                    : async () => [submission({ id: 12, timestamp: Math.floor(startedAt / 1000) })],
                getSubmissionDetail: stalledOperation === "detail"
                    ? async (_id, signal) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; }))
                    : async () => detail("correct();"),
            }),
            /submission-correlation-timeout/,
        );
        assert.equal(aborted, true, `${stalledOperation} request should be aborted`);
        assert.ok(Date.now() - startedAt < 500, `${stalledOperation} request exceeded its deadline`);
    }
});

test("preserves program-significant trailing whitespace when matching code", async () => {
    const mismatches = [
        ["const template = `line  `;", "const template = `line `;"],
        ["value = '''\nline  \n''' ", "value = '''\nline  \n'''"],
    ];

    for (const [submittedCode, detailCode] of mismatches) {
        let currentTime = 500_000;
        assert.notEqual(normalizeSubmissionCode(submittedCode), normalizeSubmissionCode(detailCode));
        await assert.rejects(correlateSubmission({
            questionNumber: "42",
            expectedSlug: "answer",
            submissionIds: [],
            submittedCode,
            startedAtMs: 499_000,
            timeoutMs: 10,
            pollIntervalMs: 10,
            clockSkewMs: 0,
        }, {
            listProblemSubmissions: async () => [submission({ id: 13, timestamp: 500 })],
            getSubmissionDetail: async () => detail(detailCode),
            now: () => currentTime,
            sleep: async (ms) => { currentTime += ms; },
        }), /13:code-mismatch/);
    }
});
