const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const compiledRoot = path.resolve(__dirname, "../../out-test");
const {
    installedNeetCodeDataStore,
    NeetCodeDataStore,
} = require(path.join(compiledRoot, "integrations/neetcode/dataStore.js"));

function writeJson(root, relativePath, value) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(value)}\n`, "utf8");
}

function createDataRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "leetnotion-neetcode-store-"));
    const metadata = {
        questionId: "427",
        title: "Construct Quad Tree",
        titleSlug: "construct-quad-tree",
        code: "0427-construct-quad-tree",
        contentFile: "neetcode-content/427.json",
        neetcode150: false,
        blind75: false,
    };
    writeJson(root, "neetcode-index.json", {
        schemaVersion: 2,
        generatedAt: "2026-08-19T00:00:00.000Z",
        source: { repository: "https://github.com/neetcode-gh/leetcode", revision: "a".repeat(40) },
        problemCount: 1,
        neetcode150Count: 0,
        blind75Count: 0,
        problems: { 427: metadata },
    });
    writeJson(root, "neetcode-content/427.json", {
        schemaVersion: 1,
        questionId: "427",
        titleSlug: "construct-quad-tree",
        articleMarkdown: "quad article",
    });
    writeJson(root, "jit-learning-resources.json", {
        schemaVersion: 1,
        source: { name: "resources.md", sha256: "B".repeat(64) },
        problemCount: 1,
        problems: {
            "construct-quad-tree": {
                sourceIndex: 1,
                title: "Construct Quad Tree",
                titleSlug: "construct-quad-tree",
                section: "Trees",
                difficulty: "Medium",
                markdown: "learn quads",
            },
        },
    });
    return { root, metadata };
}

test("loads the metadata index once and lazily caches only selected content", () => {
    const { root, metadata } = createDataRoot();
    try {
        const store = new NeetCodeDataStore(root);
        const index = store.getIndex();
        assert.equal(index.problems["427"].articleMarkdown, undefined);
        assert.equal(store.getIndex(), index);

        const first = store.getContent(metadata);
        assert.equal(first.articleMarkdown, "quad article");
        writeJson(root, "neetcode-content/427.json", {
            schemaVersion: 1,
            questionId: "427",
            titleSlug: "construct-quad-tree",
            articleMarkdown: "changed on disk",
        });
        assert.equal(store.getContent(metadata), first, "selected content should be cached after its first read");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("resolves checked-in installed data from unbundled test output", () => {
    const index = installedNeetCodeDataStore.getIndex();
    assert.equal(index.problemCount, 767);
    assert.equal(index.source.revision, "62d62811315e676691c4b8fef58af73494d58b79");
});

test("reports actionable installed-data diagnostics for missing, malformed, and unsafe content", () => {
    const { root, metadata } = createDataRoot();
    try {
        fs.rmSync(path.join(root, "neetcode-content/427.json"));
        const store = new NeetCodeDataStore(root);
        assert.throws(
            () => store.getContent(metadata),
            /Unable to load NeetCode content for problem 427.*427\.json.*Reinstall.*validate:data/,
        );
        assert.throws(
            () => store.getContent({ ...metadata, contentFile: "../outside.json" }),
            /unsafe or mismatched content path/,
        );

        writeJson(root, "neetcode-content/427.json", { schemaVersion: 1, questionId: "999", titleSlug: "wrong" });
        assert.throws(
            () => new NeetCodeDataStore(root).getContent(metadata),
            /content identity does not match index entry 427\/construct-quad-tree/,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("service merges selected content and JIT metadata without rereading either dataset", () => {
    const globalStatePath = path.join(compiledRoot, "globalState.js");
    const previousModule = require.cache[globalStatePath];
    require.cache[globalStatePath] = {
        id: globalStatePath,
        filename: globalStatePath,
        loaded: true,
        exports: { globalState: { getTitleSlugQuestionNumberMapping: () => ({}) } },
        children: [],
        paths: [],
    };

    try {
        delete require.cache[path.join(compiledRoot, "integrations/neetcode/service.js")];
        const { NeetCodeService } = require(path.join(compiledRoot, "integrations/neetcode/service.js"));
        let indexReads = 0;
        let contentReads = 0;
        let learningReads = 0;
        const metadata = {
            questionId: "427",
            title: "Construct Quad Tree",
            titleSlug: "construct-quad-tree",
            code: "0427-construct-quad-tree",
            contentFile: "neetcode-content/427.json",
        };
        const service = new NeetCodeService({
            getIndex: () => {
                indexReads += 1;
                return { problems: { 427: metadata } };
            },
            getContent: () => {
                contentReads += 1;
                return { articleMarkdown: "quad article", hintMarkdown: "quad hint" };
            },
            getLearningDataset: () => {
                learningReads += 1;
                return { problems: { "construct-quad-tree": { markdown: "learn quads" } } };
            },
        });

        const first = service.getProblemMetadata({ id: "427" });
        const second = service.getProblemMetadata({ id: "427" });
        assert.deepEqual(
            {
                articleMarkdown: first.articleMarkdown,
                hintMarkdown: first.hintMarkdown,
                learningMarkdown: first.learningMarkdown,
            },
            { articleMarkdown: "quad article", hintMarkdown: "quad hint", learningMarkdown: "learn quads" },
        );
        assert.equal(second.learningMarkdown, "learn quads");
        assert.equal(indexReads, 1);
        assert.equal(learningReads, 1);
        assert.equal(contentReads, 2, "service delegates content caching to the data store");
    } finally {
        if (previousModule) {
            require.cache[globalStatePath] = previousModule;
        } else {
            delete require.cache[globalStatePath];
        }
    }
});
