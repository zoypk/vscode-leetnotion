const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "../..");
const cleanUrl = pathToFileURL(path.join(repositoryRoot, "scripts/clean.mjs")).href;
const verifierUrl = pathToFileURL(path.join(repositoryRoot, "scripts/verify-vsix.mjs")).href;

const bundledDependencies = {
    "@leetnotion/leetcode-api": "^3.0.0",
    "@leetnotion/notion-api": "^0.0.2",
    "@vscode/webview-ui-toolkit": "^1.4.0",
    axios: "^1.15.1",
    esbuild: "^0.28.0",
    "fs-extra": "^11.3.4",
    "highlight.js": "^11.11.1",
    lodash: "^4.18.1",
    "markdown-it": "^14.1.1",
    mixpanel: "^0.21.0",
    "require-from-string": "^2.0.2",
    "unescape-js": "^1.1.4",
};

test("keeps only separately loaded packages as production dependencies", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
    const lockfile = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package-lock.json"), "utf8"));
    const runtimeDependencies = {
        bottleneck: "^2.19.5",
        "ts-fsrs": "^5.3.2",
        "vsc-leetcode-cli": "2.8.1",
    };

    assert.deepEqual(manifest.dependencies, runtimeDependencies);
    assert.deepEqual(lockfile.packages[""].dependencies, runtimeDependencies);
    for (const [name, specifier] of Object.entries(bundledDependencies)) {
        assert.equal(manifest.devDependencies[name], specifier, `${name} must retain its version specifier`);
        assert.equal(lockfile.packages[""].devDependencies[name], specifier, `${name} lock specifier must match`);
    }
});

test("uses dedicated clean, pinned package, and VSIX verification commands", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
    const packageScript = fs.readFileSync(path.join(repositoryRoot, "scripts/package-extension.mjs"), "utf8");
    const buildScript = fs.readFileSync(path.join(repositoryRoot, "scripts/build.mjs"), "utf8");

    assert.equal(manifest.scripts.clean, "node ./scripts/clean.mjs");
    assert.equal(manifest.scripts.package, "node ./scripts/package-extension.mjs");
    assert.equal(manifest.scripts["verify:vsix"], "node ./scripts/verify-vsix.mjs");
    assert.match(packageScript, /VSCE_VERSION = "2\.15\.0"/);
    assert.match(packageScript, /@vscode\/vsce@\$\{VSCE_VERSION\}/);
    assert.match(buildScript, /await cleanGeneratedTargets\(rootDir\)/);
    assert.equal(fs.existsSync(path.join(repositoryRoot, "esbuild.js")), false);
});

test("clean removes only the ignored generated target allowlist", async () => {
    const { GENERATED_TARGETS, cleanGeneratedTargets } = await import(cleanUrl);
    const ignoredTargets = childProcess.execFileSync(
        "git",
        ["check-ignore", "--no-index", ...GENERATED_TARGETS],
        { cwd: repositoryRoot, encoding: "utf8" },
    ).trim().split(/\r?\n/).map((entry) => entry.replace(/\\/g, "/"));
    assert.deepEqual(ignoredTargets.sort(), [...GENERATED_TARGETS].sort());

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "leetnotion-clean-"));
    try {
        for (const target of GENERATED_TARGETS) {
            const absolutePath = path.join(root, target);
            fs.mkdirSync(path.extname(absolutePath) ? path.dirname(absolutePath) : absolutePath, { recursive: true });
            if (path.extname(absolutePath)) {
                fs.writeFileSync(absolutePath, "generated");
            } else {
                fs.writeFileSync(path.join(absolutePath, "generated.txt"), "generated");
            }
        }
        const preserved = [
            "src/extension.ts",
            "public/scripts/script.js",
            "public/scripts/profile-dashboard.js",
            "data/neetcode-index.json",
        ];
        for (const relativePath of preserved) {
            const absolutePath = path.join(root, relativePath);
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, "preserve");
        }

        await cleanGeneratedTargets(root);

        for (const target of GENERATED_TARGETS) {
            assert.equal(fs.existsSync(path.join(root, target)), false, `${target} should be removed`);
        }
        for (const relativePath of preserved) {
            assert.equal(fs.readFileSync(path.join(root, relativePath), "utf8"), "preserve");
        }
    } finally {
        fs.rmSync(root, { force: true, recursive: true });
    }
});

test("requires every indexed NeetCode content file and core runtime asset", async () => {
    const { requiredVsixPaths } = await import(verifierUrl);
    const index = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "data/neetcode-index.json"), "utf8"));
    const required = requiredVsixPaths(index);
    const indexedContent = Object.values(index.problems).filter((problem) => problem.contentFile);

    assert.equal(required.filter((entry) => entry.startsWith("extension/data/neetcode-content/")).length, indexedContent.length);
    assert.ok(required.includes("extension/out/src/extension.js"));
    for (const resourcePath of [
        "blank.png",
        "check.png",
        "dark/dislike.png",
        "dark/like.png",
        "LeetCode.svg",
        "LeetNotion.png",
        "light/dislike.png",
        "light/like.png",
        "lock.png",
        "x.png",
    ]) {
        assert.ok(required.includes(`extension/resources/${resourcePath}`));
    }
    assert.ok(required.includes("extension/data/company-data.json"));
    assert.ok(required.includes("extension/data/jit-learning-resources.json"));
    assert.ok(required.includes("extension/node_modules/bottleneck/package.json"));
    assert.ok(required.includes("extension/node_modules/bottleneck/lib/index.js"));
    assert.ok(required.includes("extension/node_modules/ts-fsrs/package.json"));
    assert.ok(required.includes("extension/node_modules/ts-fsrs/dist/index.cjs"));
    assert.ok(required.includes("extension/node_modules/vsc-leetcode-cli/package.json"));
    assert.ok(required.includes("extension/node_modules/vsc-leetcode-cli/bin/leetcode"));
    assert.ok(required.includes("extension/node_modules/lodash/lodash.js"));
});

test("VSIX contract rejects missing, forbidden, oversized, and over-count artifacts", async () => {
    const { validateVsixEntries } = await import(verifierUrl);
    const valid = [{ name: "extension/required.txt", uncompressedSize: 10 }];
    assert.deepEqual(
        validateVsixEntries(valid, { requiredPaths: ["extension/required.txt"], vsixSize: 10 }),
        { fileCount: 1, unpackedSize: 10, vsixSize: 10 },
    );
    assert.throws(
        () => validateVsixEntries(valid, { requiredPaths: ["extension/missing.txt"], vsixSize: 10 }),
        /required packaged path is missing/,
    );
    assert.throws(
        () => validateVsixEntries([{ name: "extension/src/secret.ts", uncompressedSize: 1 }], { requiredPaths: [], vsixSize: 1 }),
        /forbidden packaged path/,
    );
    assert.throws(
        () => validateVsixEntries([{ name: "extension/app.js.map", uncompressedSize: 1 }], { requiredPaths: [], vsixSize: 1 }),
        /source map is forbidden/,
    );
    assert.throws(
        () => validateVsixEntries([{ name: "extension/large.bin", uncompressedSize: 50 * 1024 * 1024 + 1 }], { requiredPaths: [], vsixSize: 1 }),
        /unpacked size/,
    );
    assert.throws(
        () => validateVsixEntries(valid, { requiredPaths: [], vsixSize: 15 * 1024 * 1024 + 1 }),
        /VSIX size/,
    );
    const tooMany = Array.from({ length: 2_501 }, (_, index) => ({ name: `extension/file-${index}`, uncompressedSize: 0 }));
    assert.throws(
        () => validateVsixEntries(tooMany, { requiredPaths: [], vsixSize: 1 }),
        /file count/,
    );
});

test("vscodeignore excludes first-party source and build inputs but keeps runtime data and output", () => {
    const ignored = fs.readFileSync(path.join(repositoryRoot, ".vscodeignore"), "utf8").split(/\r?\n/);
    for (const requiredIgnore of ["src/**", "scripts/**", "test/**", "docs", ".github/**", "**/*.map", "package-lock.json", "tsconfig.json", "esbuild.js"]) {
        assert.ok(ignored.includes(requiredIgnore), `${requiredIgnore} must be ignored`);
    }
    for (const runtimePath of ["out/**", "data/**", "public/**", "resources/**", "node_modules/**"]) {
        assert.equal(ignored.includes(runtimePath), false, `${runtimePath} must remain packageable`);
    }
});
