const assert = require("node:assert/strict");
const test = require("node:test");

const { parseWebviewMessage } = require("../../out-test/webview/webviewMessages.js");

const schema = {
    open: ["id"],
    refresh: [],
};

test("accepts only exact actions and declared string fields", () => {
    assert.deepEqual(parseWebviewMessage({ action: "open", id: "opaque-1" }, schema), {
        action: "open",
        values: { id: "opaque-1" },
    });
    assert.deepEqual(parseWebviewMessage({ action: "refresh" }, schema), {
        action: "refresh",
        values: {},
    });
});

test("rejects malformed and oversized messages", () => {
    for (const value of [null, [], "open", 1, { action: "missing" }, { action: "open" }, { action: "open", id: 1 }]) {
        assert.equal(parseWebviewMessage(value, schema), undefined);
    }
    assert.equal(parseWebviewMessage({ action: "open", id: "x".repeat(513) }, schema), undefined);
    assert.equal(parseWebviewMessage({ action: "open", id: "opaque" }, schema, "action", 5), undefined);
});

test("rejects client-supplied identity or URL fields", () => {
    assert.equal(parseWebviewMessage({ action: "open", id: "opaque", url: "https://evil.test" }, schema), undefined);
    assert.equal(parseWebviewMessage({ action: "open", id: "opaque", problem: { id: "forged" } }, schema), undefined);
    assert.equal(parseWebviewMessage({ command: "open", id: "opaque" }, schema), undefined);
});
