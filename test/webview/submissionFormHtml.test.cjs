const assert = require("node:assert/strict");
const test = require("node:test");

const { renderSubmissionFormHtml } = require("../../out-test/webview/submissionFormState.js");
const fs = require("node:fs");
const path = require("node:path");

test("uses non-executable JSON, semantic review controls, and valid color disclosure", () => {
    const html = renderSubmissionFormHtml({
        configJson: "{\"notes\":\"\\u003c/script\\u003e\"}",
        scriptUri: "vscode-webview://script.js",
        toolkitUri: "vscode-webview://toolkit.js",
        nonce: "nonce-value",
        selectedFlagType: "WHITE",
        flagOptions: [
            { value: "WHITE", label: "White" },
            { value: "RED", label: "Red" },
        ],
    });
    assert.match(html, /<script type="application\/json" id="submission-form-state">/);
    assert.doesNotMatch(html, /window\.__LEETNOTION/);
    assert.match(html, /<fieldset id="review-container">/);
    assert.match(html, /<legend>Review schedule<\/legend>/);
    assert.match(html, /<label for="review-date-input">Review date<\/label>/);
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, /<details id="submission-flag-disclosure">\s*<summary>LeetCode color<\/summary>/);
    assert.match(html, /role="radiogroup"/);
    assert.match(html, /tabindex="0"/);
    assert.match(html, /tabindex="-1"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /nonce="nonce-value"/);
});

test("each supported LeetCode color has a distinct CSP-safe CSS rule", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "..", "public", "styles", "style.css"), "utf8");
    for (const color of ["WHITE", "RED", "ORANGE", "YELLOW", "GREEN", "BLUE", "PURPLE"]) {
        assert.match(css, new RegExp(`data-flag-value=\\"${color}\\"`));
    }
    assert.doesNotMatch(css, /javascript:/i);
});
