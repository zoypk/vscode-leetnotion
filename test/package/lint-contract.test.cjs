const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..", "..");

test("lint checks declared build dependencies without disabling implicit dependency checks", () => {
    const config = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "tslint.json"), "utf8"));
    const rule = config.rules["no-implicit-dependencies"];

    assert.equal(rule[0], true);
    assert.ok(rule.includes("dev"));
    assert.ok(!rule.includes("optional"));
    assert.deepEqual(rule.find(Array.isArray), ["vscode"]);
});
