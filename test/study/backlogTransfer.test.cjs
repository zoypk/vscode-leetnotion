const assert = require("node:assert/strict");
const test = require("node:test");

const { BacklogTransferError, transferBacklogToReview } = require("../../out-test/study/backlogTransfer");

const target = {
    questionNumber: "42",
    name: "Trapping Rain Water",
    difficulty: "Hard",
};

test("review creation failure leaves the backlog untouched", async () => {
    let removals = 0;
    await assert.rejects(() => transferBacklogToReview(target, "good", {
        ensureReview: async () => { throw new Error("review unavailable"); },
        removeBacklog: async () => { removals += 1; },
    }), /review unavailable/);
    assert.equal(removals, 0);
});

test("backlog deletion failure leaves a recoverable duplicate and retry does not re-rate", async () => {
    let reviewExists = false;
    let ratings = 0;
    let removals = 0;
    let failRemoval = true;
    const dependencies = {
        ensureReview: async () => {
            if (reviewExists) { return "existing"; }
            reviewExists = true;
            ratings += 1;
            return "added";
        },
        removeBacklog: async () => {
            removals += 1;
            if (failRemoval) { throw new Error("disk full"); }
        },
    };

    await assert.rejects(() => transferBacklogToReview(target, "easy", dependencies), (error) => {
        assert.ok(error instanceof BacklogTransferError);
        assert.equal(error.questionNumber, "42");
        assert.equal(error.reviewWasScheduled, true);
        assert.equal(error.cause.message, "disk full");
        assert.equal("originalError" in error, false);
        return true;
    });
    assert.equal(reviewExists, true);
    assert.equal(ratings, 1);

    failRemoval = false;
    const result = await transferBacklogToReview(target, "easy", dependencies);
    assert.deepEqual(result, { review: "existing", backlogRemoved: true });
    assert.equal(ratings, 1);
    assert.equal(removals, 2);
});

test("schedules the review before removing the backlog", async () => {
    const order = [];
    await transferBacklogToReview(target, "again", {
        ensureReview: async (_id, snapshot, rating) => {
            order.push(`review:${snapshot.name}:${rating}`);
            return "added";
        },
        removeBacklog: async () => { order.push("backlog"); },
    });
    assert.deepEqual(order, ["review:Trapping Rain Water:again", "backlog"]);
});

test("deletion diagnostics normalize whitespace and bound the underlying message", async () => {
    const detail = `  could not   delete\nbacklog\tentry ${"x".repeat(1000)}  `;

    await assert.rejects(() => transferBacklogToReview(target, "hard", {
        ensureReview: async () => "added",
        removeBacklog: async () => { throw new Error(detail); },
    }), (error) => {
        assert.ok(error instanceof BacklogTransferError);
        assert.match(error.message, /could not delete backlog entry/);
        assert.doesNotMatch(error.message, /\s{2,}|[\r\n\t]/);
        assert.ok(error.message.length <= 400, `message had ${error.message.length} characters`);
        assert.equal(error.cause.message, detail);
        return true;
    });
});

test("question diagnostics are normalized and bounded without changing the recovery identifier", async () => {
    const questionNumber = `  42\n\t${"q".repeat(1000)}  `;
    const hostileTarget = { ...target, questionNumber };

    await assert.rejects(() => transferBacklogToReview(hostileTarget, "hard", {
        ensureReview: async () => "added",
        removeBacklog: async () => { throw new Error("disk full"); },
    }), (error) => {
        assert.ok(error instanceof BacklogTransferError);
        assert.equal(error.questionNumber, questionNumber);
        assert.match(error.message, /Review 42 q+/);
        assert.doesNotMatch(error.message, /\s{2,}|[\r\n\t]/);
        assert.ok(error.message.length <= 400, `message had ${error.message.length} characters`);
        return true;
    });

    const emptyQuestion = new BacklogTransferError(" \n\t ", new Error("disk full"));
    assert.match(emptyQuestion.message, /Review Unknown question was scheduled/);
    assert.equal(emptyQuestion.questionNumber, " \n\t ");
});
