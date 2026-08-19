const assert = require("node:assert/strict");
const test = require("node:test");

const { getQuestionNumber } = require("../../out-test/utils/toolUtils.js");

test("uses the @lc source marker for custom filenames", () => {
    const source = "// @lc app=leetcode id=42 lang=typescript\n// @lc code=start\nreturn 42;\n// @lc code=end";

    assert.equal(getQuestionNumber("C:\\solutions\\answer.ts", source), "42");
});

test("preserves source marker IDs containing spaces", () => {
    const source = "// @lc app=leetcode.cn id=剑指 Offer 03 lang=typescript\n// @lc code=start\nreturn 42;\n// @lc code=end";

    assert.equal(getQuestionNumber("C:\\solutions\\answer.ts", source), "剑指 Offer 03");
});

test("falls back to the conventional numeric filename", () => {
    assert.equal(getQuestionNumber("C:\\solutions\\42.two-sum.ts"), "42");
    assert.equal(getQuestionNumber("C:\\solutions\\answer.ts"), null);
});
