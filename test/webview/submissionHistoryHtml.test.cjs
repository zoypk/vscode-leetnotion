const assert = require("node:assert/strict");
const test = require("node:test");

const {
    parseSubmissionHistoryMessage,
    renderSubmissionHistoryHtml,
    resolveSubmissionHistoryMessage,
} = require("../../out-test/webview/submissionHistoryHtml.js");
const { keepTrustedSubmissionUrls } = require("../../out-test/submissions/submissionHistory.js");

function submission(overrides = {}) {
    return {
        code: "",
        compare_result: "",
        flag_type: 0,
        has_notes: false,
        id: 42,
        is_pending: "false",
        lang: "python3",
        lang_name: "Python3",
        memory: "14 MB",
        question_id: 1,
        runtime: "31 ms",
        status: 10,
        status_display: "Accepted",
        time: "",
        timestamp: 1700000000,
        title: "Two Sum",
        title_slug: "two-sum",
        url: "https://leetcode.com/submissions/detail/42/?forged='yes'",
        ...overrides,
    };
}

test("renders an informative empty state in the rich history view", () => {
    const html = renderSubmissionHistoryHtml({
        nonce: "nonce-value-123456",
        problemTitle: "Lowe's problem",
        questionNumber: "1",
        submissions: [],
    });

    assert.match(html, /Lowe&#39;s problem/);
    assert.match(html, /No past submissions found for problem 1/);
    assert.match(html, /0 submissions found/);
});

test("uses a nonce CSP and delegated opaque-ID actions without rendering URLs", () => {
    const item = submission({ status_display: `Accepted 'fast' <script>alert(1)</script>` });
    const html = renderSubmissionHistoryHtml({
        nonce: "nonce-value-123456",
        problemTitle: "Two Sum",
        questionNumber: "1",
        submissions: [item],
    });

    assert.match(html, /script-src 'nonce-nonce-value-123456'/);
    assert.match(html, /style-src 'nonce-nonce-value-123456'/);
    assert.match(html, /<script nonce="nonce-value-123456">/);
    assert.match(html, /data-action="open-detail" data-submission-id="42"/);
    assert.match(html, /data-action="open-external" data-submission-id="42"/);
    assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|onclick=/);
    assert.doesNotMatch(html, /https:\/\/leetcode\.com\/submissions/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("accepts only exact supported actions and a positive integer submission ID", () => {
    assert.deepEqual(
        parseSubmissionHistoryMessage({ action: "open-detail", submissionId: 42 }),
        { action: "open-detail", submissionId: 42 },
    );
    assert.deepEqual(
        parseSubmissionHistoryMessage({ action: "open-external", submissionId: 42 }),
        { action: "open-external", submissionId: 42 },
    );
    assert.equal(parseSubmissionHistoryMessage({ action: "open-detail", submissionId: 42, url: "https://evil.example" }), undefined);
    assert.equal(parseSubmissionHistoryMessage({ action: "open-detail", submissionId: "42" }), undefined);
    assert.equal(parseSubmissionHistoryMessage({ action: "delete", submissionId: 42 }), undefined);
    assert.equal(parseSubmissionHistoryMessage({ action: "open-detail", submissionId: 0 }), undefined);
});

test("resolves actions only against provider-owned submission state", () => {
    const authoritative = submission({ id: 42, url: "https://leetcode.com/submissions/detail/42/" });
    const submissionsById = new Map([[42, authoritative]]);

    assert.deepEqual(
        resolveSubmissionHistoryMessage({ action: "open-external", submissionId: 42 }, submissionsById),
        { action: "open-external", submissionId: 42, submission: authoritative },
    );
    assert.equal(resolveSubmissionHistoryMessage({ action: "open-external", submissionId: 99 }, submissionsById), undefined);
    assert.equal(resolveSubmissionHistoryMessage({ action: "open-external", submissionId: 42, url: "https://evil.example" }, submissionsById), undefined);
});

test("cannot resolve an action for an authoritative row with a malicious URL", () => {
    const trusted = keepTrustedSubmissionUrls([
        submission({ id: 42, url: "https://leetcode.com/submissions/detail/42/" }),
        submission({ id: 43, url: "command:workbench.action.closeWindow" }),
        submission({ id: 44, url: "file:///tmp/secret" }),
        submission({ id: 45, url: "https://evil.example/submissions/detail/45/" }),
    ], "https://leetcode.com");
    const submissionsById = new Map(trusted.map((item) => [item.id, item]));

    assert.equal(trusted.length, 1);
    assert.equal(resolveSubmissionHistoryMessage({ action: "open-external", submissionId: 43 }, submissionsById), undefined);
    assert.equal(resolveSubmissionHistoryMessage({ action: "open-external", submissionId: 44 }, submissionsById), undefined);
    assert.equal(resolveSubmissionHistoryMessage({ action: "open-external", submissionId: 45 }, submissionsById), undefined);
});
