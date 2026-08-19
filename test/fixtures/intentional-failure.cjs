const assert = require("node:assert/strict");
const test = require("node:test");

test("intentional failure fixture", () => {
    assert.fail("intentional failure fixture");
});
