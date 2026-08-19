const assert = require("node:assert/strict");
const test = require("node:test");

const { parseSubmissionPropertiesMessage } = require("../../out-test/webview/submissionMessages.js");

function valid(overrides = {}) {
    return {
        command: "set-properties",
        notes: "remember the invariant",
        flagType: "WHITE",
        review: { kind: "unchanged" },
        isOptimal: false,
        tags: ["Graph", "BFS"],
        ...overrides,
    };
}

test("accepts each explicit review edit without identity fields", () => {
    assert.deepEqual(parseSubmissionPropertiesMessage(valid()), valid());
    assert.deepEqual(parseSubmissionPropertiesMessage(valid({ review: { kind: "clear" } })).review, { kind: "clear" });
    assert.deepEqual(parseSubmissionPropertiesMessage(valid({ review: { kind: "date", value: "2026-08-31" } })).review,
        { kind: "date", value: "2026-08-31" });
    assert.deepEqual(parseSubmissionPropertiesMessage(valid({ review: { kind: "rating", value: "good" } })).review,
        { kind: "rating", value: "good" });
});

test("rejects forged IDs and unknown commands or fields", () => {
    for (const input of [
        valid({ questionNumber: "999" }),
        valid({ questionPageId: "forged" }),
        valid({ submissionPageId: "forged" }),
        valid({ command: "delete-page" }),
        valid({ extra: true }),
    ]) {
        assert.throws(() => parseSubmissionPropertiesMessage(input), /invalid-submission-properties-message/);
    }
});

test("rejects invalid dates, ratings, flags, and review unions", () => {
    for (const input of [
        valid({ review: { kind: "date", value: "2026-02-30" } }),
        valid({ review: { kind: "date", value: "31-08-2026" } }),
        valid({ review: { kind: "rating", value: "perfect" } }),
        valid({ review: { kind: "unchanged", value: "2026-08-31" } }),
        valid({ review: { kind: "date", value: "2026-08-31", rating: "good" } }),
        valid({ flagType: "INVISIBLE" }),
    ]) {
        assert.throws(() => parseSubmissionPropertiesMessage(input), /invalid-submission-properties-message/);
    }
});

test("bounds notes and normalizes unique nonblank tags", () => {
    assert.throws(() => parseSubmissionPropertiesMessage(valid({ notes: "x".repeat(20_001) })), /invalid-submission-properties-message/);
    assert.throws(() => parseSubmissionPropertiesMessage(valid({ tags: ["Graph", " graph "] })), /invalid-submission-properties-message/);
    assert.throws(() => parseSubmissionPropertiesMessage(valid({ tags: [""] })), /invalid-submission-properties-message/);
    assert.throws(() => parseSubmissionPropertiesMessage(valid({ tags: ["x".repeat(101)] })), /invalid-submission-properties-message/);
    assert.deepEqual(parseSubmissionPropertiesMessage(valid({ tags: [" Graph ", "BFS"] })).tags, ["Graph", "BFS"]);
});

test("rejects malformed or oversized envelopes", () => {
    for (const input of [null, [], "set-properties", { command: "set-properties" }, valid({ tags: Array(101).fill("x") })]) {
        assert.throws(() => parseSubmissionPropertiesMessage(input), /invalid-submission-properties-message/);
    }
});
