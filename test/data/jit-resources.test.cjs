const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "../..");
const datasetPath = path.join(repositoryRoot, "data/jit-learning-resources.json");
const importerUrl = pathToFileURL(path.join(repositoryRoot, "scripts/import-jit-learning-resources.mjs")).href;
const validationUrl = pathToFileURL(path.join(repositoryRoot, "scripts/lib/data-validation.mjs")).href;

function buildSource(overrides = {}) {
    const rows = [];
    const slugs = new Set();
    for (let index = 1; index <= 250; index += 1) {
        const slug = overrides.slugAt === index ? overrides.slug : `problem-${index}`;
        const resourceUrl = overrides.urlAt === index ? overrides.url : `https://example.com/resource-${index}`;
        rows.push(
            `| ${index} | | [Problem ${index}](https://leetcode.com/problems/${slug}/) | Easy | [Read](${resourceUrl}) |`,
        );
        slugs.add(`problem-${index}`);
    }
    return {
        source: Buffer.from(`# 1. Arrays\n\n${rows.join("\n")}\n`, "utf8"),
        slugs,
    };
}

test("checked-in JIT data carries independently verifiable provenance without the source Markdown", () => {
    const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
    assert.equal(dataset.schemaVersion, 1);
    assert.equal(dataset.source.name, "NeetCode-250-JIT-concept-reference-revised.md");
    assert.match(dataset.source.sha256, /^[A-F0-9]{64}$/);
    assert.equal(
        dataset.source.sha256,
        "02AE3E7ACD9F325D8250DF77B88B8FDD8F277B0430699DE0680137FE561CB3A4",
    );
    assert.equal(dataset.problemCount, 250);
    assert.equal(Object.keys(dataset.problems).length, 250);
    assert.equal(dataset.classificationSource.name, "NeetCode-250-combined-JIT-takeUforward-priority-guide.md");
    assert.equal(dataset.classificationSource.sha256, "3E91C62CBC7B620055495291049932DAAA9151E85705928E7272BEB41A6B0347");
    assert.equal(dataset.classifiedArtifactCount, 1089);
    assert.equal(dataset.jitVideoUseCount, 235);
    assert.equal(dataset.takeUforwardCount, 113);
    assert.deepEqual(Object.keys(dataset.priorityLegend), ["M", "S", "C", "R"]);
    assert.ok(dataset.problems["concatenation-of-array"]);
    assert.equal(
        Object.values(dataset.problems).reduce(
            (count, problem) => count + Array.from(problem.markdown.matchAll(/\]\(https:\/\//g)).length,
            0,
        ),
        1141,
    );
    assert.equal(
        Object.values(dataset.problems).filter((problem) => problem.markdown.includes("**takeUforward anchor**")).length,
        113,
    );
    const priorityCounts = { M: 0, "M*": 0, S: 0, C: 0, R: 0, "Direct attempt": 0 };
    for (const problem of Object.values(dataset.problems)) {
        for (const match of problem.markdown.matchAll(/^`(M\*?|S|C|R|Direct attempt)`\s/gm)) {
            priorityCounts[match[1]] += 1;
        }
    }
    assert.deepEqual(priorityCounts, { M: 424, "M*": 8, S: 226, C: 515, R: 19, "Direct attempt": 10 });
});

test("source-independent validator accepts the checked-in records and rejects malformed provenance and content", async () => {
    const { validateJitLearningDataset } = await import(validationUrl);
    const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
    const index = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "data/neetcode-index.json"), "utf8"));
    const knownSlugs = new Set(Object.values(index.problems).map((problem) => problem.titleSlug));
    assert.deepEqual(validateJitLearningDataset(dataset, knownSlugs), { problemCount: 250 });

    const invalid = structuredClone(dataset);
    invalid.source.sha256 = "not-a-hash";
    invalid.problems["concatenation-of-array"].sourceIndex = 2;
    invalid.problems["concatenation-of-array"].markdown = "[Insecure](http://example.com/)";
    invalid.problems["concatenation-of-array"].section = "";
    assert.throws(
        () => validateJitLearningDataset(invalid, knownSlugs),
        (error) => {
            assert.match(error.message, /source\.sha256/);
            assert.match(error.message, /duplicates sourceIndex 2/);
            assert.match(error.message, /section must be nonempty/);
            assert.match(error.message, /non-HTTPS learning link/);
            assert.match(error.message, /sourceIndex 1 is missing/);
            return true;
        },
    );
});

test("importer hashes exact source bytes and preserves 250 known unique records", async () => {
    const { parseLearningResources } = await import(importerUrl);
    const { source, slugs } = buildSource();
    const dataset = parseLearningResources(source, slugs, "fixture.md");

    assert.equal(
        dataset.source.sha256,
        crypto.createHash("sha256").update(source).digest("hex").toUpperCase(),
    );
    assert.equal(dataset.source.name, "fixture.md");
    assert.equal(dataset.problemCount, 250);
    assert.deepEqual(
        Object.values(dataset.problems).map((problem) => problem.sourceIndex),
        Array.from({ length: 250 }, (_, index) => index + 1),
    );
});

test("importer rejects unknown slugs and non-HTTPS learning links", async () => {
    const { parseLearningResources } = await import(importerUrl);
    const unknown = buildSource({ slugAt: 250, slug: "unknown-problem" });
    assert.throws(
        () => parseLearningResources(unknown.source, unknown.slugs, "unknown.md"),
        /missing from NeetCode data: unknown-problem/,
    );

    const insecure = buildSource({ urlAt: 250, url: "http://example.com/insecure" });
    assert.throws(
        () => parseLearningResources(insecure.source, insecure.slugs, "insecure.md"),
        /Unsupported resource URL for problem-250/,
    );
});
