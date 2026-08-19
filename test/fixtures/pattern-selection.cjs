const assert = require("node:assert/strict");
const test = require("node:test");

test("selected passing fixture", () => {
    assert.equal(1 + 1, 2);
});

test("unselected failure fixture", () => {
    assert.fail("the name pattern should skip this failure");
});
