const assert = require("node:assert/strict");
const test = require("node:test");

const {
    buildActivityGraph,
    buildRecentSubmission,
    summarizeActivity,
} = require("../../out-test/home/profileDashboardModel");

function calendarFor(entries) {
    return JSON.stringify(Object.fromEntries(entries.map(([isoDate, count]) => [
        Date.parse(`${isoDate}T00:00:00.000Z`) / 1000,
        count,
    ])));
}

test("builds 18 Sunday-based weeks and stops the current week on Wednesday", () => {
    const now = new Date("2026-08-19T23:59:59.000Z");
    const graph = buildActivityGraph(calendarFor([
        ["2026-08-16", 1],
        ["2026-08-17", 2],
        ["2026-08-18", 3],
        ["2026-08-19", 4],
        ["2026-08-20", 99],
    ]), now);

    assert.equal(graph.weeks.length, 18);
    assert.equal(graph.weeks[0][0].date, "2026-04-19");
    assert.deepEqual(
        graph.weeks.at(-1).map((cell) => [cell.date, cell.count]),
        [
            ["2026-08-16", 1],
            ["2026-08-17", 2],
            ["2026-08-18", 3],
            ["2026-08-19", 4],
        ],
    );
    assert.equal(graph.rangeLabel, "Apr 19, 2026 – Aug 19, 2026");
});

test("uses UTC dates consistently around a local-time boundary", () => {
    const graph = buildActivityGraph(
        calendarFor([["2026-08-19", 2]]),
        new Date("2026-08-19T00:15:00.000Z"),
    );

    assert.equal(graph.weeks.at(-1).at(-1).date, "2026-08-19");
    assert.equal(graph.weeks.at(-1).at(-1).count, 2);
});

test("continues a current streak from yesterday when today has no submission", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");

    assert.equal(summarizeActivity(calendarFor([
        ["2026-08-16", 1],
        ["2026-08-17", 1],
        ["2026-08-18", 1],
    ]), now).currentStreak, 3);
    assert.equal(summarizeActivity(calendarFor([
        ["2026-08-17", 1],
        ["2026-08-19", 1],
    ]), now).currentStreak, 1);
    assert.equal(summarizeActivity(calendarFor([
        ["2026-08-17", 1],
    ]), now).currentStreak, 0);
});

test("constructs links only from a validated title slug and configured base", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const valid = buildRecentSubmission({
        title: "Two Sum",
        titleSlug: "two-sum",
        timestamp: String(Date.parse("2026-08-19T11:00:00.000Z") / 1000),
        lang: "typescript",
        runtime: "40 ms",
    }, "https://leetcode.cn", now);

    assert.equal(valid.url, "https://leetcode.cn/problems/two-sum/");
    assert.equal(valid.relativeTime, "1h ago");
    assert.equal(buildRecentSubmission({
        title: "Unsafe",
        titleSlug: "two-sum/\" onclick=\"alert(1)",
        timestamp: "0",
        lang: "js",
        runtime: "-",
    }, "https://leetcode.com", now), undefined);
    assert.equal(buildRecentSubmission({
        title: "Unsafe base",
        titleSlug: "two-sum",
        timestamp: "0",
        lang: "js",
        runtime: "-",
    }, "javascript:alert(1)", now), undefined);
});
