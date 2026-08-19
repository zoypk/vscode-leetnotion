const assert = require("node:assert/strict");
const test = require("node:test");

const {
    applySavedSubmissionState,
    chooseReviewDate,
    chooseReviewRating,
    createSubmissionFormState,
    moveRadioIndex,
    matchesSubmissionContext,
} = require("../../out-test/webview/submissionFormState.js");

const initial = {
    notes: "old",
    flagType: "RED",
    isOptimal: true,
    tags: ["A"],
    reviewDate: "2026-08-20",
};

test("date and rating exclusion is symmetric", () => {
    const state = createSubmissionFormState(initial);
    const rated = chooseReviewRating(chooseReviewDate(state, "2026-08-31"), "hard");
    assert.deepEqual(rated.review, { kind: "rating", value: "hard" });
    assert.equal(rated.reviewDateInput, "");

    const dated = chooseReviewDate(rated, "2026-09-01");
    assert.deepEqual(dated.review, { kind: "date", value: "2026-09-01" });
    assert.equal(dated.selectedRating, undefined);
});

test("successful save installs every authoritative field and clears one-shot review controls", () => {
    let state = createSubmissionFormState(initial);
    state = { ...state, notes: "draft", tags: ["A", "B"], isOptimal: false, flagType: "WHITE" };
    state = chooseReviewRating(state, "good");
    const saved = applySavedSubmissionState(state, {
        notes: "server note",
        flagType: "WHITE",
        isOptimal: false,
        tags: ["B"],
        reviewDate: "2026-09-09",
    });
    assert.deepEqual(saved, {
        notes: "server note",
        flagType: "WHITE",
        isOptimal: false,
        tags: ["B"],
        reviewDate: "2026-09-09",
        review: { kind: "unchanged" },
        reviewDateInput: "",
        selectedRating: undefined,
    });
});

test("authoritative tag state supports A to B to A without stale selections", () => {
    const start = createSubmissionFormState(initial);
    const b = applySavedSubmissionState(start, { ...initial, tags: ["B"] });
    const a = applySavedSubmissionState(b, { ...initial, tags: ["A"] });
    assert.deepEqual(b.tags, ["B"]);
    assert.deepEqual(a.tags, ["A"]);
});

test("failed save preservation is achieved by leaving state untouched", () => {
    const draft = chooseReviewRating({ ...createSubmissionFormState(initial), notes: "unsaved", tags: ["B"] }, "easy");
    assert.deepEqual(draft, chooseReviewRating({ ...createSubmissionFormState(initial), notes: "unsaved", tags: ["B"] }, "easy"));
});

test("radio arrow navigation wraps in both directions", () => {
    assert.equal(moveRadioIndex(0, "ArrowLeft", 7), 6);
    assert.equal(moveRadioIndex(6, "ArrowRight", 7), 0);
    assert.equal(moveRadioIndex(3, "Home", 7), 0);
    assert.equal(moveRadioIndex(3, "End", 7), 6);
    assert.equal(moveRadioIndex(3, "Enter", 7), 3);
});

test("late Notion results cannot attach to a newer submission panel", () => {
    const active = { submissionId: 101, questionNumber: "42" };
    assert.equal(matchesSubmissionContext(active, { submissionId: 101, questionNumber: "42" }), true);
    assert.equal(matchesSubmissionContext(active, { submissionId: 100, questionNumber: "42" }), false);
    assert.equal(matchesSubmissionContext(active, { submissionId: 101, questionNumber: "43" }), false);
    assert.equal(matchesSubmissionContext(undefined, { submissionId: 101, questionNumber: "42" }), false);
});
