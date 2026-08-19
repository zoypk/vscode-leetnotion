const assert = require("node:assert/strict");
const test = require("node:test");

const {
    collectExistingSubmissionIds,
    formatBulkImportResult,
    parseSubmissionRows,
    runBulkImport,
} = require("../../out-test/submissions/bulkImport.js");

function submission(id, slug = `problem-${id}`) {
    return {
        code: "return 1",
        id,
        lang: "javascript",
        status_display: "Accepted",
        timestamp: 1_700_000_000,
        title: `Problem ${id}`,
        title_slug: slug,
    };
}

test("validates the root and tolerates malformed rows", () => {
    assert.throws(() => parseSubmissionRows({ rows: [] }), /invalid-submissions-root/);
    const parsed = parseSubmissionRows([submission(1), null, {}, submission(2)]);
    assert.deepEqual(parsed.submissions.map(({ id }) => id), [1, 2]);
    assert.equal(parsed.malformed, 2);
});

test("blank or malformed Notion rich text is counted and ignored", () => {
    const result = collectExistingSubmissionIds([
        { properties: { "Submission ID": { rich_text: [{ plain_text: "1" }] } } },
        { properties: { "Submission ID": { rich_text: [] } } },
        { properties: {} },
        null,
    ]);
    assert.deepEqual([...result.ids], ["1"]);
    assert.equal(result.malformed, 3);
});

test("reports added, existing, malformed, and missing-question counts", async () => {
    const progress = [];
    const result = await runBulkImport({
        submissions: [submission(1), submission(3, "missing"), submission(2)],
        existingIds: new Set(["1"]),
        malformed: 2,
        resolveQuestion: (row) => row.title_slug === "missing" ? undefined : { questionNumber: "2", pageId: "page-2" },
        create: async (row) => `created-${row.id}`,
        onCreated: (counts) => progress.push({ ...counts }),
        isCancelled: () => false,
    });
    assert.deepEqual(result, { added: 1, existing: 1, malformed: 2, missingQuestion: 1, cancelled: false });
    assert.deepEqual(progress, [{ added: 1, existing: 1, malformed: 2, missingQuestion: 1, cancelled: false }]);
});

test("progress advances only after creation and cancellation reports partial completion", async () => {
    const events = [];
    let cancelled = false;
    const result = await runBulkImport({
        submissions: [submission(1), submission(2)],
        existingIds: new Set(),
        malformed: 0,
        resolveQuestion: () => ({ questionNumber: "1", pageId: "page" }),
        create: async (row) => {
            events.push(`created-${row.id}`);
            cancelled = true;
        },
        onCreated: (counts) => events.push(`progress-${counts.added}`),
        isCancelled: () => cancelled,
    });
    assert.deepEqual(events, ["created-1", "progress-1"]);
    assert.deepEqual(result, { added: 1, existing: 0, malformed: 0, missingQuestion: 0, cancelled: true });
});

test("counts a created page even when optional code attachment fails", async () => {
    const events = [];
    const result = await runBulkImport({
        submissions: [submission(1)],
        existingIds: new Set(),
        malformed: 0,
        resolveQuestion: () => ({ questionNumber: "1", pageId: "page" }),
        create: async () => "submission-page",
        afterCreate: async () => { throw new Error("code upload failed"); },
        onCreated: ({ added }) => events.push(`added-${added}`),
        onPostCreateError: (error) => events.push(error.message),
    });
    assert.equal(result.added, 1);
    assert.deepEqual(events, ["added-1", "code upload failed"]);
});

test("zero-added and partial final messages are truthful", () => {
    assert.equal(formatBulkImportResult({ added: 0, existing: 3, malformed: 0, missingQuestion: 0, cancelled: false }),
        "No new submissions were added. 3 already existed.");
    assert.equal(formatBulkImportResult({ added: 1, existing: 2, malformed: 3, missingQuestion: 4, cancelled: true }),
        "Import cancelled after adding 1 submission. 2 already existed, 3 malformed, and 4 missing questions.");
});
