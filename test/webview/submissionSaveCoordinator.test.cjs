const assert = require("node:assert/strict");
const test = require("node:test");

const { SubmissionSaveCoordinator, reviewEditKey } = require("../../out-test/webview/submissionSaveCoordinator.js");

function state(notes = "old") {
    return { notes, flagType: "WHITE", isOptimal: false, tags: [], reviewDate: null };
}

function submission(submissionId, questionNumber = "42") {
    return { submissionId, questionNumber, title: "Problem", notes: "", flagType: "WHITE" };
}

function notion(submissionId, questionNumber = "42") {
    return {
        submissionId,
        questionNumber,
        questionPageId: "question-page",
        submissionPageId: "submission-page",
        tags: [],
        reviewDate: null,
    };
}

test("a save snapshot cannot mutate a newer submission generation", () => {
    const coordinator = new SubmissionSaveCoordinator();
    coordinator.begin(submission(1), state("A"), true);
    const saveA = coordinator.snapshotForSave({ kind: "unchanged" });
    coordinator.begin(submission(2, "43"), state("B"), false);

    assert.equal(coordinator.installSaved(saveA.generation, state("A saved")), false);
    assert.equal(coordinator.currentState.notes, "B");
    assert.equal(coordinator.isCurrent(saveA.generation), false);
});

test("pending Notion context blocks review edits until the exact context resolves", () => {
    const coordinator = new SubmissionSaveCoordinator();
    coordinator.begin(submission(1), state(), true);
    assert.throws(() => coordinator.snapshotForSave({ kind: "rating", value: "good" }), /notion-context-pending/);
    assert.doesNotThrow(() => coordinator.snapshotForSave({ kind: "unchanged" }));

    assert.equal(coordinator.installNotionContext(notion(99)), false);
    assert.equal(coordinator.notionPending, true);
    assert.equal(coordinator.installNotionContext(notion(1)), true);
    assert.equal(coordinator.notionPending, false);
    assert.equal(coordinator.markNotionUnavailable({ submissionId: 1, questionNumber: "42" }), false);
    assert.doesNotThrow(() => coordinator.snapshotForSave({ kind: "rating", value: "good" }));
});

test("a failed pending Notion sync unlocks local review without affecting another generation", () => {
    const coordinator = new SubmissionSaveCoordinator();
    coordinator.begin(submission(1), state(), true);
    assert.equal(coordinator.markNotionUnavailable({ submissionId: 2, questionNumber: "42" }), false);
    assert.equal(coordinator.notionPending, true);
    assert.equal(coordinator.markNotionUnavailable({ submissionId: 1, questionNumber: "42" }), true);
    assert.equal(coordinator.notionPending, false);
});

test("committed review results are reused only for the same operation and generation", () => {
    const coordinator = new SubmissionSaveCoordinator();
    coordinator.begin(submission(1), state(), false);
    const snapshot = coordinator.snapshotForSave({ kind: "rating", value: "good" });
    const key = reviewEditKey({ kind: "rating", value: "good" });
    coordinator.recordCommittedReview(snapshot.generation, key, "2026-09-09");
    assert.equal(coordinator.getCommittedReview(snapshot.generation, key), "2026-09-09");
    assert.equal(coordinator.getCommittedReview(snapshot.generation, reviewEditKey({ kind: "rating", value: "hard" })), undefined);

    coordinator.begin(submission(2), state(), false);
    assert.equal(coordinator.getCommittedReview(snapshot.generation, key), undefined);
});

test("successful completion clears the committed retry value", () => {
    const coordinator = new SubmissionSaveCoordinator();
    coordinator.begin(submission(1), state(), false);
    const snapshot = coordinator.snapshotForSave({ kind: "clear" });
    const key = reviewEditKey({ kind: "clear" });
    coordinator.recordCommittedReview(snapshot.generation, key, null);
    assert.equal(coordinator.hasCommittedReview(snapshot.generation, key), true);
    assert.equal(coordinator.installSaved(snapshot.generation, state("saved")), true);
    assert.equal(coordinator.hasCommittedReview(snapshot.generation, key), false);
});
