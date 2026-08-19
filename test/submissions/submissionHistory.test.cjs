const assert = require("node:assert/strict");
const test = require("node:test");

const { collectSubmissionHistory } = require("../../out-test/submissions/submissionHistory.js");

function row(id, timestamp = id) {
    return { id, timestamp };
}

test("collects 45 unique rows using offsets 0, 20, and 40, then sorts newest first", async () => {
    const source = Array.from({ length: 45 }, (_, index) => row(index + 1));
    const calls = [];

    const result = await collectSubmissionHistory(async (offset, limit) => {
        calls.push([offset, limit]);
        return source.slice(offset, offset + limit);
    });

    assert.deepEqual(calls, [[0, 20], [20, 20], [40, 20]]);
    assert.equal(result.length, 45);
    assert.deepEqual(result.map((item) => item.id), source.map((item) => item.id).reverse());
});

test("stops at 100 submissions without requesting a sixth page", async () => {
    const source = Array.from({ length: 140 }, (_, index) => row(index + 1));
    const offsets = [];

    const result = await collectSubmissionHistory(async (offset, limit) => {
        offsets.push(offset);
        return source.slice(offset, offset + limit);
    });

    assert.equal(result.length, 100);
    assert.deepEqual(offsets, [0, 20, 40, 60, 80]);
});

test("terminates on a duplicate-only page and keeps the first authoritative row", async () => {
    const calls = [];
    const first = [row(1, 20), row(2, 10)];

    const result = await collectSubmissionHistory(async (offset) => {
        calls.push(offset);
        return offset === 0 ? first : [row(1, 999), row(2, 999)];
    }, { pageSize: 2 });

    assert.deepEqual(calls, [0, 2]);
    assert.deepEqual(result, first);
});

test("ignores invalid identifiers and supports an empty partial page", async () => {
    const result = await collectSubmissionHistory(async () => [row(0), row(-1)], { pageSize: 20 });
    assert.deepEqual(result, []);
});
