const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { createSubmissionSourceSnapshot } = require("../../out-test/submissions/sourceSnapshot.js");

test("creates an exact private snapshot with the original extension and removes it", async () => {
    const content = "# @lc app=leetcode id=42 lang=python3\n# @lc code=start\nvalue = '''  \nline  \n''' \n# @lc code=end\n";
    const snapshot = await createSubmissionSourceSnapshot(path.join("C:\\solutions", "custom.py"), content);

    assert.equal(path.basename(snapshot.filePath), "custom.py");
    assert.equal(await fs.readFile(snapshot.filePath, "utf8"), content);
    assert.equal(snapshot.code, "value = '''  \nline  \n''' ");

    await snapshot.dispose();
    await assert.rejects(fs.stat(snapshot.filePath), { code: "ENOENT" });
});

test("preserves marker-free numeric and compound-language basenames", async () => {
    const cases = [
        {
            originalPath: "C:\\solutions\\42.two-sum.ts",
            content: "export function twoSum() { return [0, 1]; }\r\n",
            expectedCode: "export function twoSum() { return [0, 1]; }\n",
            expectedQuestionNumber: "42",
        },
        {
            originalPath: "C:\\solutions\\42.two-sum.python3.py",
            content: "# @lc app=leetcode id=42 lang=python3\n# @lc code=start\nreturn [0, 1]\n# @lc code=end\n",
            expectedCode: "return [0, 1]",
            expectedQuestionNumber: "42",
        },
    ];

    for (const entry of cases) {
        const snapshot = await createSubmissionSourceSnapshot(entry.originalPath, entry.content);
        try {
            assert.equal(path.basename(snapshot.filePath), path.basename(entry.originalPath));
            assert.equal(await fs.readFile(snapshot.filePath, "utf8"), entry.content);
            assert.equal(snapshot.questionNumber, entry.expectedQuestionNumber);
            assert.equal(snapshot.code, entry.expectedCode);
        } finally {
            await snapshot.dispose();
        }
    }
});
