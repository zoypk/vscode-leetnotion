const assert = require("node:assert/strict");
const test = require("node:test");

const {
    parseSubmissionDetailMessage,
    renderSubmissionDetailHtml,
    resolveSubmissionDetailMessage,
} = require("../../out-test/webview/submissionDetailHtml.js");

function options() {
    return {
        nonce: "detail-nonce-123456",
        problemTitle: "Lowe's <problem>",
        questionNumber: "1",
        submission: {
            id: 77,
            title: "Lowe's <problem>",
            questionNumber: "1",
            url: "https://leetcode.com/submissions/detail/77/?url='private'",
            timestamp: 1700000000,
            lang: `C++ '23`,
            runtime: "1 ms",
            memory: "2 MB",
            status_display: "Accepted <ok>",
        },
        detail: {
            code: `if (a < b) return "'quoted'";`,
            runtime_percentile: 99.123,
            memory_percentile: null,
            notes: "",
            flag_type: "WHITE",
            details: {
                total_correct: 10,
                total_testcases: 10,
                compare_result: "Accepted",
                testcase: "<input>",
                stdout: "'output'",
                error: ["<error>"],
            },
        },
    };
}

test("renders quote-bearing detail values safely with back and open actions", () => {
    const html = renderSubmissionDetailHtml(options());

    assert.match(html, /Lowe&#39;s &lt;problem&gt;/);
    assert.match(html, /C\+\+ &#39;23/);
    assert.match(html, /if \(a &lt; b\) return &quot;&#39;quoted&#39;&quot;;/);
    assert.match(html, /data-action="back" data-submission-id="77"/);
    assert.match(html, /data-action="open-external" data-submission-id="77"/);
    assert.match(html, /script-src 'nonce-detail-nonce-123456'/);
    assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|onclick=/);
    assert.doesNotMatch(html, /https:\/\/leetcode\.com\/submissions/);
});

test("accepts only exact back/open actions bound to a numeric ID", () => {
    assert.deepEqual(parseSubmissionDetailMessage({ action: "back", submissionId: 77 }), { action: "back", submissionId: 77 });
    assert.deepEqual(parseSubmissionDetailMessage({ action: "open-external", submissionId: 77 }), { action: "open-external", submissionId: 77 });
    assert.equal(parseSubmissionDetailMessage({ action: "open-external", submissionId: 77, url: "https://evil.example" }), undefined);
    assert.equal(parseSubmissionDetailMessage({ action: "back", submissionId: 77, title: "forged" }), undefined);
    assert.equal(parseSubmissionDetailMessage({ action: "back", submissionId: Number.NaN }), undefined);
    assert.equal(parseSubmissionDetailMessage(null), undefined);
});

test("rejects a valid-looking action for any submission other than the active one", () => {
    assert.deepEqual(
        resolveSubmissionDetailMessage({ action: "open-external", submissionId: 77 }, 77),
        { action: "open-external", submissionId: 77 },
    );
    assert.equal(resolveSubmissionDetailMessage({ action: "open-external", submissionId: 78 }, 77), undefined);
    assert.equal(resolveSubmissionDetailMessage({ action: "open-external", submissionId: 77, url: "https://evil.example" }, 77), undefined);
});
