const assert = require("node:assert/strict");
const test = require("node:test");

const {
    parseProfileDashboardAction,
    renderProfileDashboardPage,
} = require("../../out-test/home/profileDashboardHtml");

function readyState() {
    return {
        status: "ready",
        signedInUsername: "signed-in",
        model: {
            username: "lookup-user",
            displayName: "Lookup <User>",
            avatar: "https://example.com/avatar.png",
            summaryText: "A profile",
            solvedTotal: "3 / 10",
            progressRows: [{ label: "Easy", solved: 2, total: 4, percent: 50 }],
            activity: { currentStreak: 2, activeDays30: 3, totalActiveDays: 4 },
            activityGraph: {
                weeks: [[
                    { date: "2026-08-16", dateLabel: "Aug 16, 2026", count: 0, level: 0 },
                    { date: "2026-08-17", dateLabel: "Aug 17, 2026", count: 2, level: 4 },
                ]],
                maxCount: 2,
                rangeLabel: "Aug 16, 2026 – Aug 17, 2026",
            },
            contest: undefined,
            recentAccepted: [{
                title: "Two Sum",
                url: "https://leetcode.com/problems/two-sum/",
                lang: "typescript",
                runtime: "40 ms",
                relativeTime: "1h ago",
            }],
        },
    };
}

test("renders a decorative graph with an exact date and count table alternative", () => {
    const html = renderProfileDashboardPage(readyState(), {
        nonce: "abc123",
        cspSource: "vscode-webview://test",
        scriptUri: "vscode-webview://test/profile-dashboard.js",
    });

    assert.match(html, /class="heatmap-grid" aria-hidden="true"/);
    assert.match(html, /<table>/);
    assert.match(html, /<th scope="col">Date<\/th>/);
    assert.match(html, /<td>Aug 16, 2026<\/td>\s*<td>0<\/td>/);
    assert.match(html, /<td>Aug 17, 2026<\/td>\s*<td>2<\/td>/);
    assert.match(html, /<summary>Activity data by date<\/summary>/);
});

test("uses native progress, nonce CSP and delegated data actions", () => {
    const html = renderProfileDashboardPage(readyState(), {
        nonce: "abc123",
        cspSource: "vscode-webview://test",
        scriptUri: "vscode-webview://test/profile-dashboard.js",
    });

    assert.match(html, /style-src 'nonce-abc123'/);
    assert.match(html, /script-src 'nonce-abc123'/);
    assert.match(html, /<style nonce="abc123">/);
    assert.match(html, /<script nonce="abc123" src="vscode-webview:\/\/test\/profile-dashboard\.js"><\/script>/);
    assert.match(html, /<progress value="2" max="4"/);
    assert.match(html, /data-action="refresh"/);
    assert.match(html, /id="refresh-status"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(html, /style="/i);
    assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});

test("escapes profile text and omits unsafe recent links", () => {
    const state = readyState();
    state.model.recentAccepted.push({
        title: "Bad",
        url: "javascript:alert(1)",
        lang: "js",
        runtime: "-",
        relativeTime: "Now",
    });
    const html = renderProfileDashboardPage(state, {
        nonce: "abc123",
        cspSource: "vscode-webview://test",
        scriptUri: "vscode-webview://test/profile-dashboard.js",
    });

    assert.match(html, /Lookup &lt;User&gt;/);
    assert.match(html, /Two Sum/);
    assert.doesNotMatch(html, /javascript:/i);
});

test("accepts only exact, known dashboard actions", () => {
    assert.equal(parseProfileDashboardAction({ action: "refresh" }), "refresh");
    assert.equal(parseProfileDashboardAction({ action: "deleteEverything" }), undefined);
    assert.equal(parseProfileDashboardAction({ action: "refresh", username: "forged" }), undefined);
    assert.equal(parseProfileDashboardAction("refresh"), undefined);
});
