const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const importerPath = path.resolve(__dirname, "..", "scripts", "import-jit-learning-resources.mjs");

test("parses the artifact-reference row format", async () => {
    const { parseResourceDocument } = await import(pathToFileURL(importerPath).href);
    const source = [
        "- **Coverage:** 1 problem.",
        "# 1. Arrays & Hashing",
        "| # | Problem | Difficulty | Recognition cue | Relevant concept artifacts | Return when… |",
        "| -: | --- | :---: | --- | --- | --- |",
        "| 1 | [Two Sum](https://leetcode.com/problems/two-sum/) | Easy | Find the complement. | 🔴 [Hashing](https://example.com/hashing)<br>📖 [Sets](https://example.com/sets) | Explain the lookup invariant. |",
    ].join("\n");

    const result = parseResourceDocument(source, new Set(["two-sum"]));

    assert.equal(result.problemCount, 1);
    assert.deepEqual(result.problems["two-sum"], {
        sourceIndex: 1,
        title: "Two Sum",
        titleSlug: "two-sum",
        section: "Arrays & Hashing",
        difficulty: "Easy",
        markdown: "**Cue:** Find the complement.\n\n🔴 [Hashing](https://example.com/hashing)\n\n📖 [Sets](https://example.com/sets)\n\n**Return:** Explain the lookup invariant.",
    });
});

test("keeps the earlier inline JIT row format importable", async () => {
    const { parseResourceDocument } = await import(pathToFileURL(importerPath).href);
    const source = [
        "- **Coverage:** all **1** current problem.",
        "# 1. Arrays & Hashing",
        "| # | Done | Problem | Difficulty | JIT learning |",
        "| -: | :---: | --- | :---: | --- |",
        "| 1 | ⬜ | [Two Sum](https://leetcode.com/problems/two-sum/) | Easy | **Cue:** Find the complement.<br>🔴 [Hashing](https://example.com/hashing)<br>**Return:** Explain the lookup invariant. |",
    ].join("\n");

    const result = parseResourceDocument(source, new Set(["two-sum"]));

    assert.equal(result.problemCount, 1);
    assert.match(result.problems["two-sum"].markdown, /^\*\*Cue:\*\*/);
    assert.match(result.problems["two-sum"].markdown, /\*\*Return:\*\*/);
});

test("rejects unsafe learning-resource URLs", async () => {
    const { parseResourceDocument } = await import(pathToFileURL(importerPath).href);
    const source = [
        "- **Coverage:** 1 problem.",
        "# 1. Arrays & Hashing",
        "| 1 | [Two Sum](https://leetcode.com/problems/two-sum/) | Easy | Find the complement. | [Unsafe](javascript:alert(1)) | Explain the invariant. |",
    ].join("\n");

    assert.throws(
        () => parseResourceDocument(source, new Set(["two-sum"])),
        /Unsupported resource URL/,
    );
});
