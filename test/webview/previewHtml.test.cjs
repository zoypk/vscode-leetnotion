const assert = require("node:assert/strict");
const test = require("node:test");

const { renderProblemPreviewHtml, renderSolutionPreviewHtml } = require("../../out-test/webview/previewHtml.js");

function problemModel(overrides = {}) {
    return {
        actionScriptUri: "webview-resource:/public/scripts/webview-actions.js",
        cspSource: "webview-resource:",
        descriptionHtml: '<p>Understand <strong>the problem</strong>.</p>',
        disclosures: [
            { title: "Tags", items: [{ id: "tag-0", label: "Array" }] },
            { title: "Companies", items: [{ id: "company-0", label: "Lowe's" }] },
            { title: "Sheets", items: [{ id: "sheet-0", label: "NeetCode 150" }] },
        ],
        learningResourcesHtml: '<p><a href="https://example.com/learn">Guide</a></p>',
        linkActions: [{ id: "past-submissions", label: "Past Submissions" }],
        linksHtml: '<p><a href="https://leetcode.com/problems/two-sum/submissions/">Submissions</a></p>',
        neetCode: {
            articleHtml: '<p>Article</p><pre><code>long_line()</code></pre>',
            hintHtml: '<details class="hint-accordion"><summary>Hint</summary><p>Try a map.</p></details>',
            linksHtml: '<p><a href="https://neetcode.io/problems/two-sum">NeetCode</a></p>',
            metadataHtml: '<p><code>Arrays &amp; Hashing</code></p>',
        },
        nonce: "previewNonce123",
        overviewHtml: "<h1>Two Sum</h1>",
        solveActionId: "solve",
        stylesHtml: '<link rel="stylesheet" href="webview-resource:/markdown.css">',
        ...overrides,
    };
}

test("renders quote-bearing labels as text and opaque delegated actions", () => {
    const html = renderProblemPreviewHtml(problemModel());
    assert.match(html, /<code>Lowe&#39;s<\/code>/);
    assert.match(html, /data-action-id="company-0"/);
    assert.doesNotMatch(html, /onclick=|onTagClick|onCompanyClick|onSheetClick|showPastSubmissions/);
    assert.match(html, /<script nonce="previewNonce123" type="module" src="webview-resource:\/public\/scripts\/webview-actions\.js"><\/script>/);
});

test("sanitizes every remote or imported preview fragment", () => {
    const payload = '<svg><script>alert(1)</script></svg><img src="javascript:alert(2)" onerror="alert(3)"><p>safe</p>';
    const html = renderProblemPreviewHtml(problemModel({
        descriptionHtml: payload,
        learningResourcesHtml: payload,
        linksHtml: payload,
        neetCode: { articleHtml: payload, hintHtml: payload, linksHtml: payload, metadataHtml: payload },
        overviewHtml: payload,
    }));
    assert.doesNotMatch(html, /<script>alert|<svg|javascript:|onerror=/i);
    assert.equal((html.match(/<p>safe<\/p>/g) || []).length, 8);
});

test("uses valid disclosures and covers each long-form region with the 68ch reading column", () => {
    const html = renderProblemPreviewHtml(problemModel());
    assert.equal((html.match(/<details(?:\s|>)/g) || []).length, (html.match(/<\/details>/g) || []).length);
    for (const marker of [
        'id="description" class="reading-column"',
        'id="learning-resources" class="reading-column"',
        'id="neetcode" class="reading-column"',
        'id="neetcode-hints" class="reading-column"',
        'id="neetcode-article" class="reading-column"',
    ]) {
        assert.match(html, new RegExp(marker));
    }
    assert.match(html, /\.reading-column \{ width: min\(100%, 68ch\); margin-inline: auto; \}/);
    assert.match(html, /\.reading-column pre, \.reading-column table \{[^}]*overflow-x: auto;/);
});

test("binds all executable and style content to the matching nonce and strict CSP", () => {
    const html = renderProblemPreviewHtml(problemModel());
    assert.match(html, /script-src webview-resource: &#39;nonce-previewNonce123&#39;/);
    assert.match(html, /style-src webview-resource: &#39;nonce-previewNonce123&#39;/);
    assert.equal((html.match(/<style nonce="previewNonce123">/g) || []).length, 1);
    assert.equal((html.match(/<script nonce="previewNonce123"/g) || []).length, 1);
    assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|command:|file:/);
});

test("sanitizes solution HTML and constrains it to the reading column", () => {
    const html = renderSolutionPreviewHtml({
        bodyHtml: '<p>safe</p><script>alert(1)</script>',
        cspSource: "webview-resource:",
        infoHtml: '<table><tr><td>Python</td></tr></table>',
        nonce: "solutionNonce",
        stylesHtml: "",
        titleHtml: '<h1><a href="javascript:alert(1)">Unsafe</a></h1>',
    });
    assert.match(html, /<main class="reading-column"><p>safe<\/p><\/main>/);
    assert.doesNotMatch(html, /javascript:|alert\(1\)|unsafe-inline|unsafe-eval/);
});
