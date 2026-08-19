const assert = require("node:assert/strict");
const test = require("node:test");

const {
    collectSubmissionHistory,
    keepTrustedSubmissionUrls,
    resolveLeetCodeUrl,
    returnToSubmissionHistory,
    SubmissionDetailRequestGuard,
} = require("../../out-test/submissions/submissionHistory.js");

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

test("requests a full page near the cap so mixed duplicates cannot stop collection at 99", async () => {
    const pages = new Map();
    for (let offset = 0; offset < 80; offset += 20) {
        pages.set(offset, Array.from({ length: 20 }, (_, index) => row(offset + index + 1)));
    }
    pages.set(80, [row(1), row(2), ...Array.from({ length: 18 }, (_, index) => row(81 + index))]);
    pages.set(100, [row(98), row(99), row(100), ...Array.from({ length: 17 }, (_, index) => row(101 + index))]);
    const calls = [];

    const result = await collectSubmissionHistory(async (offset, limit) => {
        calls.push([offset, limit]);
        return (pages.get(offset) || []).slice(0, limit);
    });

    assert.deepEqual(calls, [[0, 20], [20, 20], [40, 20], [60, 20], [80, 20], [100, 20]]);
    assert.equal(result.length, 100);
    assert.ok(result.some((item) => item.id === 99));
    assert.ok(result.some((item) => item.id === 100));
});

test("ignores invalid identifiers and supports an empty partial page", async () => {
    const result = await collectSubmissionHistory(async () => [row(0), row(-1)], { pageSize: 20 });
    assert.deepEqual(result, []);
});

test("prevents an older detail request from replacing a newer result", async () => {
    const guard = new SubmissionDetailRequestGuard();
    const first = deferred();
    const second = deferred();
    const shown = [];

    async function loadDetail(id, detailPromise) {
        const generation = guard.begin();
        const detail = await detailPromise;
        if (guard.isCurrent(generation)) {
            shown.push([id, detail]);
        }
    }

    const loadingFirst = loadDetail(1, first.promise);
    const loadingSecond = loadDetail(2, second.promise);
    second.resolve("second detail");
    await loadingSecond;
    first.resolve("stale first detail");
    await loadingFirst;

    assert.deepEqual(shown, [[2, "second detail"]]);
});

test("returns to an existing retained history panel without a network reload", async () => {
    let reloads = 0;
    const result = await returnToSubmissionHistory(
        () => true,
        async () => {
            reloads += 1;
            throw new Error("offline");
        },
    );

    assert.equal(result, "revealed");
    assert.equal(reloads, 0);
});

test("reloads history only when no matching retained panel exists", async () => {
    let reloads = 0;
    const result = await returnToSubmissionHistory(
        () => false,
        async () => { reloads += 1; },
    );

    assert.equal(result, "reloaded");
    assert.equal(reloads, 1);
});

test("accepts only HTTPS URLs on the configured LeetCode origin", () => {
    const baseUrl = "https://leetcode.com";
    assert.equal(resolveLeetCodeUrl("/submissions/detail/42/", baseUrl), "https://leetcode.com/submissions/detail/42/");
    assert.equal(resolveLeetCodeUrl("https://leetcode.com/submissions/detail/42/", baseUrl), "https://leetcode.com/submissions/detail/42/");
    assert.equal(resolveLeetCodeUrl("http://leetcode.com/submissions/detail/42/", baseUrl), undefined);
    assert.equal(resolveLeetCodeUrl("command:workbench.action.closeWindow", baseUrl), undefined);
    assert.equal(resolveLeetCodeUrl("file:///etc/passwd", baseUrl), undefined);
    assert.equal(resolveLeetCodeUrl("", baseUrl), undefined);
    assert.equal(resolveLeetCodeUrl(null, baseUrl), undefined);
    assert.equal(resolveLeetCodeUrl("https://leetcode.com.evil.example/submissions/detail/42/", baseUrl), undefined);
    assert.equal(resolveLeetCodeUrl("https://evil.example/submissions/detail/42/", baseUrl), undefined);
});

test("drops authoritative API rows whose URLs are outside the configured host", () => {
    const submissions = [
        { id: 1, url: "/submissions/detail/1/" },
        { id: 2, url: "command:workbench.action.closeWindow" },
        { id: 3, url: "file:///tmp/submission" },
        { id: 4, url: "https://evil.example/submissions/detail/4/" },
    ];

    assert.deepEqual(
        keepTrustedSubmissionUrls(submissions, "https://leetcode.com"),
        [{ id: 1, url: "https://leetcode.com/submissions/detail/1/" }],
    );
});

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}
