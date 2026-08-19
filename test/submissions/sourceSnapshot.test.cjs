const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { createSubmissionSourceSnapshot } = require("../../out-test/submissions/sourceSnapshot.js");

test("creates an exact private snapshot with the original extension and removes it", async () => {
    const content = "# @lc app=leetcode id=42 lang=python3\n# @lc code=start\nvalue = '''  \nline  \n''' \n# @lc code=end\n";
    const snapshot = await createSubmissionSourceSnapshot(path.join("C:\\solutions", "custom.py"), content);

    assert.equal(path.extname(snapshot.filePath), ".py");
    assert.equal(await fs.readFile(snapshot.filePath, "utf8"), content);
    assert.equal(snapshot.code, "value = '''  \nline  \n''' ");

    await snapshot.dispose();
    await assert.rejects(fs.stat(snapshot.filePath), { code: "ENOENT" });
});
