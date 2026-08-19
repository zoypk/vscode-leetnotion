const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "../..");
const dataRoot = path.join(repositoryRoot, "data");
const validationUrl = pathToFileURL(path.join(repositoryRoot, "scripts/lib/neetcode-validation.mjs")).href;
const syncUtilsUrl = pathToFileURL(path.join(repositoryRoot, "scripts/lib/sync-utils.mjs")).href;
const publisherUrl = pathToFileURL(path.join(repositoryRoot, "scripts/lib/neetcode-publish.mjs")).href;
const typescriptCompiler = path.join(repositoryRoot, "node_modules/typescript/bin/tsc");

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
    invalid.problems["1"].code = 1;
    invalid.problems["1"].pattern = { invalid: true };
    invalid.problems["1"].difficulty = "Impossible";
    invalid.problems["1"].neetcode150 = "yes";
    invalid.problems["1"].articleMarkdown = "large inline content";
    invalid.problems["427"].contentFile = "../427.json";
    invalid.neetcode150Count = 149;
    contents.delete("neetcode-content/1.json");

    assert.throws(
        () => validateNeetCodeDataset(invalid, contents),
        (error) => {
            assert.match(error.message, /duplicates titleSlug/);
            assert.match(error.message, /code must contain its numeric ID/);
            assert.match(error.message, /pattern must be a nonempty string/);
            assert.match(error.message, /difficulty must be Easy, Medium, or Hard/);
            assert.match(error.message, /neetcode150 and blind75 must be booleans/);
            assert.match(error.message, /embeds articleMarkdown/);
            assert.match(error.message, /contentFile must be neetcode-content\/427\.json/);
            assert.match(error.message, /NeetCode 150 count must be 150/);
            assert.match(error.message, /unreferenced content file neetcode-content\/427\.json/);
            return true;
        },
    );
});

test("exported generator builds fixture mappings, provenance, and isolated Construct Quad Tree content", async () => {
    const compiledRoot = fs.mkdtempSync(path.join(os.tmpdir(), "neetcode-generator-compiled-"));
    try {
        execFileSync(process.execPath, [
            typescriptCompiler,
            "--module", "Node16",
            "--moduleResolution", "Node16",
            "--target", "ES2020",
            "--esModuleInterop",
            "--skipLibCheck",
            "--allowJs",
            "--outDir", compiledRoot,
            "scripts/sync-neetcode-data.ts",
            "scripts/lib/sync-utils.mjs",
        ], { cwd: repositoryRoot, stdio: "pipe" });
        const { buildNeetCodeDataset } = require(path.join(compiledRoot, "sync-neetcode-data.js"));
        const fixtureRoot = path.join(repositoryRoot, "test/fixtures/neetcode-source");
        const revision = "a".repeat(40);
        const generated = await buildNeetCodeDataset(
            fixtureRoot,
            path.join(fixtureRoot, "leetcode-problems.json"),
            revision,
            "2026-08-19T00:00:00.000Z",
        );

        assert.deepEqual(
            {
                schemaVersion: generated.dataset.schemaVersion,
                generatedAt: generated.dataset.generatedAt,
                source: generated.dataset.source,
                problemCount: generated.dataset.problemCount,
                neetcode150Count: generated.dataset.neetcode150Count,
                blind75Count: generated.dataset.blind75Count,
            },
            {
                schemaVersion: 2,
                generatedAt: "2026-08-19T00:00:00.000Z",
                source: { repository: "https://github.com/neetcode-gh/leetcode", revision },
                problemCount: 1,
                neetcode150Count: 0,
                blind75Count: 0,
            },
        );
        assert.deepEqual(generated.dataset.problems["427"], {
            questionId: "427",
            title: "Construct Quad Tree",
            titleSlug: "construct-quad-tree",
            code: "0427-construct-quad-tree",
            pattern: "Trees",
            difficulty: "Medium",
            problemUrl: "https://neetcode.io/problems/construct-quad-tree",
            solutionSlug: "construct-quad-tree",
            solutionUrl: "https://neetcode.io/problems/construct-quad-tree/question/solution",
            videoUrl: undefined,
            contentFile: "neetcode-content/427.json",
            neetcode150: false,
            blind75: false,
        });
        assert.deepEqual([...generated.contents.keys()], ["427"]);
        assert.equal(generated.contents.get("427").questionId, "427");
        assert.equal(generated.contents.get("427").titleSlug, "construct-quad-tree");
        assert.match(generated.contents.get("427").articleMarkdown, /belongs only to problem 427/);
        assert.equal(generated.contents.get("427").hintMarkdown, undefined);
    } finally {
        fs.rmSync(compiledRoot, { recursive: true, force: true });
    }
});

test("source-directory verification rejects stale and dirty checkouts and returns the recorded HEAD", async () => {
    const { verifyCleanCheckoutAtRevision } = await import(syncUtilsUrl);
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "neetcode-source-checkout-"));
    try {
        execFileSync("git", ["init", "--quiet", sourceRoot]);
        execFileSync("git", ["-C", sourceRoot, "config", "user.email", "tests@example.com"]);
        execFileSync("git", ["-C", sourceRoot, "config", "user.name", "NeetCode Data Tests"]);
        execFileSync("git", ["-C", sourceRoot, "config", "core.autocrlf", "false"]);
        fs.writeFileSync(path.join(sourceRoot, "source.txt"), "committed\n", "utf8");
        execFileSync("git", ["-C", sourceRoot, "add", "source.txt"]);
        execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "fixture"]);
        const revision = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

        assert.equal(verifyCleanCheckoutAtRevision(sourceRoot, revision, "NeetCode source"), revision);
        assert.throws(
            () => verifyCleanCheckoutAtRevision(sourceRoot, "0".repeat(40), "NeetCode source"),
            /NeetCode source checkout is at .* live main is 000000/,
        );
        fs.writeFileSync(path.join(sourceRoot, "source.txt"), "dirty\n", "utf8");
        assert.throws(
            () => verifyCleanCheckoutAtRevision(sourceRoot, revision, "NeetCode source"),
            /NeetCode source checkout has uncommitted or untracked changes/,
        );
    } finally {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
});

test("publisher restores the prior index and content generation after every swap-point failure", async () => {
    const { publishNeetCodeDataset } = await import(publisherUrl);
    for (let failAt = 1; failAt <= 4; failAt += 1) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), `neetcode-publish-swap-${failAt}-`));
        const indexPath = path.join(root, "neetcode-index.json");
        const contentDirectory = path.join(root, "neetcode-content");
        fs.mkdirSync(contentDirectory);
        fs.writeFileSync(indexPath, "old-index\n", "utf8");
        fs.writeFileSync(path.join(contentDirectory, "old.json"), "old-content\n", "utf8");
        let renameCalls = 0;
        try {
            assert.throws(() => publishNeetCodeDataset({
                indexPath,
                contentDirectory,
                dataset: { generation: "new" },
                contents: new Map([["427", { generation: "new-content" }]]),
                validateDataset: (dataset, contents) => {
                    assert.equal(dataset.generation, "new");
                    assert.equal(contents.get("neetcode-content/427.json").generation, "new-content");
                },
                fsOperations: {
                    renameSync: (from, to) => {
                        renameCalls += 1;
                        if (renameCalls === failAt) {
                            throw new Error(`simulated swap failure ${failAt}`);
                        }
                        fs.renameSync(from, to);
                    },
                },
            }), new RegExp(`simulated swap failure ${failAt}`));
            assert.equal(fs.readFileSync(indexPath, "utf8"), "old-index\n");
            assert.equal(fs.readFileSync(path.join(contentDirectory, "old.json"), "utf8"), "old-content\n");
            assert.deepEqual(fs.readdirSync(contentDirectory), ["old.json"]);
            assert.deepEqual(fs.readdirSync(root).sort(), ["neetcode-content", "neetcode-index.json"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});

test("publisher treats post-commit backup cleanup as best effort for index and content generations", async () => {
    const { publishNeetCodeDataset } = await import(publisherUrl);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "neetcode-publish-cleanup-"));
    const indexPath = path.join(root, "neetcode-index.json");
    const contentDirectory = path.join(root, "neetcode-content");
    fs.mkdirSync(contentDirectory);
    fs.writeFileSync(indexPath, "old-index\n", "utf8");
    fs.writeFileSync(path.join(contentDirectory, "old.json"), "old-content\n", "utf8");
    let cleanupFailureInjected = false;
    const installedTargets = [];
    try {
        publishNeetCodeDataset({
            indexPath,
            contentDirectory,
            dataset: { generation: "new" },
            contents: new Map([["427", { generation: "new-content" }]]),
            validateDataset: () => undefined,
            fsOperations: {
                renameSync: (from, to) => {
                    if (from.includes(".tmp-")) {
                        installedTargets.push(to);
                    }
                    fs.renameSync(from, to);
                },
                rmSync: (target, options) => {
                    if (!cleanupFailureInjected && target.includes(".backup-")) {
                        cleanupFailureInjected = true;
                        throw new Error("simulated cleanup failure");
                    }
                    fs.rmSync(target, options);
                },
            },
        });
        assert.equal(cleanupFailureInjected, true);
        assert.deepEqual(
            installedTargets,
            [contentDirectory, indexPath],
            "content must publish before the index generation commit point",
        );
        assert.equal(JSON.parse(fs.readFileSync(indexPath, "utf8")).generation, "new");
        assert.equal(
            JSON.parse(fs.readFileSync(path.join(contentDirectory, "427.json"), "utf8")).generation,
            "new-content",
        );
        assert.deepEqual(fs.readdirSync(contentDirectory), ["427.json"]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
