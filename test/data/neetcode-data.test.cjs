const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "../..");
const dataRoot = path.join(repositoryRoot, "data");
const validationUrl = pathToFileURL(path.join(repositoryRoot, "scripts/lib/neetcode-validation.mjs")).href;

function loadInstalledData() {
    const index = JSON.parse(fs.readFileSync(path.join(dataRoot, "neetcode-index.json"), "utf8"));
    const contents = new Map();
    for (const fileName of fs.readdirSync(path.join(dataRoot, "neetcode-content"))) {
        if (fileName.endsWith(".json")) {
            const relativePath = `neetcode-content/${fileName}`;
            contents.set(relativePath, JSON.parse(fs.readFileSync(path.join(dataRoot, relativePath), "utf8")));
        }
    }
    return { index, contents };
}

test("validates the current metadata-only index and every referenced content file", async () => {
    const { validateNeetCodeDataset } = await import(validationUrl);
    const { index, contents } = loadInstalledData();
    const result = validateNeetCodeDataset(index, contents);

    assert.equal(index.source.revision, "62d62811315e676691c4b8fef58af73494d58b79");
    assert.equal(result.problemCount, 767);
    assert.equal(result.contentFileCount, 735);
    assert.equal(result.neetcode150Count, 150);
    assert.equal(result.blind75Count, 75);
    assert.ok(fs.statSync(path.join(dataRoot, "neetcode-index.json")).size < 1024 * 1024);
    assert.equal(JSON.stringify(index).includes("articleMarkdown"), false);
    assert.equal(JSON.stringify(index).includes("hintMarkdown"), false);
});

test("Construct Quad Tree maps only to its corrected upstream content", () => {
    const { index, contents } = loadInstalledData();
    assert.deepEqual(
        {
            questionId: index.problems["427"].questionId,
            titleSlug: index.problems["427"].titleSlug,
            code: index.problems["427"].code,
            contentFile: index.problems["427"].contentFile,
        },
        {
            questionId: "427",
            titleSlug: "construct-quad-tree",
            code: "0427-construct-quad-tree",
            contentFile: "neetcode-content/427.json",
        },
    );
    assert.equal(contents.get("neetcode-content/427.json").questionId, "427");
    assert.equal(contents.get("neetcode-content/427.json").titleSlug, "construct-quad-tree");
    assert.match(contents.get("neetcode-content/427.json").articleMarkdown, /falseLeaf/);
});

test("rejects duplicate slugs, embedded content, unsafe paths, missing files, and count drift", async () => {
    const { validateNeetCodeDataset } = await import(validationUrl);
    const { index, contents } = loadInstalledData();
    const invalid = structuredClone(index);
    invalid.problems["1"].titleSlug = invalid.problems["2"].titleSlug;
    invalid.problems["1"].articleMarkdown = "large inline content";
    invalid.problems["427"].contentFile = "../427.json";
    invalid.neetcode150Count = 149;
    contents.delete("neetcode-content/1.json");

    assert.throws(
        () => validateNeetCodeDataset(invalid, contents),
        (error) => {
            assert.match(error.message, /duplicates titleSlug/);
            assert.match(error.message, /embeds articleMarkdown/);
            assert.match(error.message, /contentFile must be neetcode-content\/427\.json/);
            assert.match(error.message, /NeetCode 150 count must be 150/);
            assert.match(error.message, /unreferenced content file neetcode-content\/427\.json/);
            return true;
        },
    );
});
