const assert = require("node:assert/strict");
const test = require("node:test");

const { selectNextStudySessionItem } = require("../../out-test/study/sessionSelection");

function review(questionNumber) {
    return { kind: "review", id: `review-${questionNumber}`, review: { questionNumber } };
}

function backlog(questionNumber) {
    return { kind: "new", id: `new-${questionNumber}`, questionNumber };
}

test("slow backlog-to-review continuation excludes the just-completed question", () => {
    const refreshedAfterSlowTransfer = [review("42"), backlog("7")];
    assert.equal(selectNextStudySessionItem(refreshedAfterSlowTransfer, "42").questionNumber, "7");
});

test("retry continuation still excludes every representation of the transferred question", () => {
    const refreshedAfterRetry = [backlog("42"), review("42"), backlog("9")];
    assert.equal(selectNextStudySessionItem(refreshedAfterRetry, "42").questionNumber, "9");
});

test("an excluded-only queue completes instead of reopening the problem", () => {
    assert.equal(selectNextStudySessionItem([review("42")], "42"), undefined);
});
