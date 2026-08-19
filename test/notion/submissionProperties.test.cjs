const assert = require("node:assert/strict");
const test = require("node:test");

const {
    applyReviewEdit,
    buildLeetCodeSubmissionUpdate,
    buildNotionPropertyUpdates,
    resolveReviewEditOnce,
} = require("../../out-test/notion/submissionProperties.js");

const saved = {
    notes: "old",
    flagType: "RED",
    isOptimal: true,
    tags: ["A", "B"],
    reviewDate: "2026-08-20",
};

test("complete Notion updates support tags A to B to A and Optimal true to false", () => {
    const first = buildNotionPropertyUpdates({ ...saved, isOptimal: false, tags: ["B"], reviewDate: "2026-08-21" }, { kind: "date", value: "2026-08-21" });
    assert.deepEqual(first.question.Tags.multi_select, [{ name: "B" }]);
    assert.deepEqual(first.submission.Tags.multi_select, []);

    const second = buildNotionPropertyUpdates({ ...saved, tags: ["A"], reviewDate: null }, { kind: "clear" });
    assert.deepEqual(second.question.Tags.multi_select, [{ name: "A" }]);
    assert.deepEqual(second.question["Review Date"], { date: null });
    assert.deepEqual(second.question.Reviewed, { checkbox: false });
});

test("unchanged review writes tags without resetting Reviewed or Review Date", () => {
    const updates = buildNotionPropertyUpdates(saved, { kind: "unchanged" });
    assert.deepEqual(updates.question.Tags.multi_select, [{ name: "A" }, { name: "B" }]);
    assert.equal(Object.hasOwn(updates.question, "Review Date"), false);
    assert.equal(Object.hasOwn(updates.question, "Reviewed"), false);
});

test("LeetCode updates preserve explicit note and flag clearing", () => {
    assert.deepEqual(buildLeetCodeSubmissionUpdate({ ...saved, notes: "", flagType: "WHITE" }), {
        notes: "",
        flagType: "WHITE",
    });
});

test("clear removes the local review and returns authoritative null", async () => {
    const calls = [];
    const reviewDate = await applyReviewEdit("42", { kind: "clear" }, {
        clear: async (id) => calls.push(["clear", id]),
        schedule: async () => assert.fail("schedule"),
        rate: async () => assert.fail("rate"),
        refresh: async () => calls.push(["refresh"]),
    });
    assert.equal(reviewDate, null);
    assert.deepEqual(calls, [["clear", "42"], ["refresh"]]);
});

test("date and rating are mutually exclusive and invoke one operation", async () => {
    const calls = [];
    const port = {
        clear: async () => assert.fail("clear"),
        schedule: async (id, date) => calls.push(["schedule", id, date]),
        rate: async (id, rating) => {
            calls.push(["rate", id, rating]);
            return "2026-09-09";
        },
        refresh: async () => calls.push(["refresh"]),
    };
    assert.equal(await applyReviewEdit("42", { kind: "date", value: "2026-08-31" }, port), "2026-08-31");
    assert.equal(await applyReviewEdit("42", { kind: "rating", value: "good" }, port), "2026-09-09");
    assert.deepEqual(calls, [
        ["schedule", "42", "2026-08-31"], ["refresh"],
        ["rate", "42", "good"], ["refresh"],
    ]);
});

test("unchanged review performs no local mutation", async () => {
    let called = false;
    const result = await applyReviewEdit("42", { kind: "unchanged" }, {
        clear: async () => { called = true; },
        schedule: async () => { called = true; },
        rate: async () => { called = true; return "never"; },
        refresh: async () => { called = true; },
    }, "2026-08-20");
    assert.equal(result, "2026-08-20");
    assert.equal(called, false);
});

test("a notes-only save after rating does not rate a second time", async () => {
    let ratings = 0;
    const port = {
        clear: async () => undefined,
        schedule: async () => undefined,
        rate: async () => { ratings += 1; return "2026-09-09"; },
        refresh: async () => undefined,
    };
    const due = await applyReviewEdit("42", { kind: "rating", value: "good" }, port);
    assert.equal(await applyReviewEdit("42", { kind: "unchanged" }, port, due), due);
    assert.equal(ratings, 1);
});

test("a retry after downstream Notion failure reuses the committed rating due date", async () => {
    let ratings = 0;
    let committed;
    const port = {
        clear: async () => undefined,
        schedule: async () => undefined,
        rate: async () => { ratings += 1; return "2026-09-09"; },
        refresh: async () => undefined,
    };
    const edit = { kind: "rating", value: "good" };
    const first = await resolveReviewEditOnce("42", edit, port, null, "rating:good", undefined,
        (key, reviewDate) => { committed = { key, reviewDate }; });
    // Simulate the Notion write failing after the local FSRS transaction committed.
    const retry = await resolveReviewEditOnce("42", edit, port, null, "rating:good", committed,
        () => assert.fail("a reused commit must not be committed twice"));
    assert.equal(first, "2026-09-09");
    assert.equal(retry, "2026-09-09");
    assert.equal(ratings, 1);
});
