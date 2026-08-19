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
    const verifierScript = fs.readFileSync(path.join(repositoryRoot, "scripts/verify-vsix.mjs"), "utf8");

    assert.equal(manifest.scripts.clean, "node ./scripts/clean.mjs");
    assert.equal(manifest.scripts.package, "node ./scripts/package-extension.mjs");
    assert.equal(manifest.scripts["verify:vsix"], "node ./scripts/verify-vsix.mjs");
    assert.match(packageScript, /VSCE_VERSION = "2\.15\.0"/);
    assert.match(packageScript, /@vscode\/vsce@\$\{VSCE_VERSION\}/);
    assert.match(buildScript, /await cleanGeneratedTargets\(rootDir\)/);
    assert.match(verifierScript, /await smokePackagedRuntime\(archive, entries\)/);
    assert.equal(fs.existsSync(path.join(repositoryRoot, "esbuild.js")), false);
});

test("verify:vsix accepts positional and documented --file artifact paths", async () => {
    const { resolveArtifactPath } = await import(verifierUrl);
    const defaultPath = path.join(repositoryRoot, "default.vsix");
    const artifactPath = path.join(repositoryRoot, "artifact.vsix");

    assert.equal(resolveArtifactPath([], defaultPath), path.resolve(defaultPath));
    assert.equal(resolveArtifactPath([artifactPath], defaultPath), path.resolve(artifactPath));
    assert.equal(resolveArtifactPath(["--file", artifactPath], defaultPath), path.resolve(artifactPath));
    assert.equal(resolveArtifactPath([`--file=${artifactPath}`], defaultPath), path.resolve(artifactPath));
    assert.throws(() => resolveArtifactPath(["--file"], defaultPath), /exactly one path/);
    assert.throws(() => resolveArtifactPath(["--unknown"], defaultPath), /Unsupported/);
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
    for (const gitMetadataPath of ["extension/.git", "extension/.git/config"]) {
        assert.throws(
            () => validateVsixEntries([{ name: gitMetadataPath, uncompressedSize: 1 }], { requiredPaths: [], vsixSize: 1 }),
            /forbidden packaged path/,
        );
    }
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

test("validates Windows-canonical paths for files and directory entries", async () => {
    const { validateVsixEntries } = await import(verifierUrl);
    const validate = (entries) => validateVsixEntries(entries, { requiredPaths: [], vsixSize: 1 });
    assert.doesNotThrow(() => validate([
        { name: "extension/", uncompressedSize: 0 },
        { name: "extension/data/", uncompressedSize: 0 },
        { name: "extension/data/file.json", uncompressedSize: 1 },
    ]));

    for (const invalidDirectory of [
        "C:/escape/",
        "/absolute/",
        "extension/../escape/",
        "extension/./escape/",
        "extension//escape/",
        "extension/trailing./",
        "extension/trailing /",
        "extension/file:stream/",
        "extension/NUL.txt/",
        "extension/CONIN$/",
        "extension/CONOUT$/",
        "extension/COM¹.txt/",
        "extension/LPT².txt/",
        "extension/nul\0name/",
    ]) {
        assert.throws(() => validate([{ name: invalidDirectory, uncompressedSize: 0 }]), /archive path|Windows|ADS|device/i);
    }
    assert.throws(
        () => validate([{ name: "extension/link", uncompressedSize: 0, isSymlink: true }]),
        /symbolic links are forbidden/,
    );
    assert.throws(
        () => validate([
            { name: "extension/Foo.txt", uncompressedSize: 1 },
            { name: "extension/foo.txt", uncompressedSize: 1 },
        ]),
        /case-insensitive archive collision/,
    );
    assert.throws(
        () => validate([
            { name: "extension/Σ.txt", uncompressedSize: 1 },
            { name: "extension/ς.txt", uncompressedSize: 1 },
        ]),
        /case-insensitive archive collision/,
    );
    assert.throws(
        () => validate([
            { name: "extension/data", uncompressedSize: 1 },
            { name: "extension/data/", uncompressedSize: 0 },
        ]),
        /file-directory collision/,
    );
    assert.throws(
        () => validate([
            { name: "extension/data", uncompressedSize: 1 },
            { name: "extension/data/file.json", uncompressedSize: 1 },
        ]),
        /file-descendant collision/,
    );
});

test("derives the non-optional runtime closure and requires every package main and bin", async () => {
    const { productionDependencyClosure, validateProductionDependencies } = await import(verifierUrl);
    const lockfile = {
        packages: {
            "": { dependencies: { vsc: "1.0.0" } },
            "node_modules/vsc": {
                version: "1.0.0",
                dependencies: { underscore: "1.0.0" },
                optionalDependencies: { jsdom: "1.0.0" },
            },
            "node_modules/underscore": { version: "1.0.0" },
            "node_modules/jsdom": { version: "1.0.0", optional: true },
        },
    };
    const manifests = {
        "node_modules/vsc": {
            name: "vsc",
            version: "1.0.0",
            dependencies: { underscore: "1.0.0" },
            optionalDependencies: { jsdom: "1.0.0" },
            main: "lib/index",
            bin: { vsc: "bin/vsc" },
        },
        "node_modules/underscore": {
            name: "underscore",
            version: "1.0.0",
            main: "underscore.js",
        },
    };
    const files = new Set([
        "extension/node_modules/vsc/package.json",
        "extension/node_modules/vsc/lib/index.js",
        "extension/node_modules/vsc/bin/vsc",
        "extension/node_modules/underscore/package.json",
        "extension/node_modules/underscore/underscore.js",
    ]);
    const options = {
        hasFile: (file) => files.has(file),
        readPackageManifest: (packagePath) => manifests[packagePath],
        rootManifest: { dependencies: { vsc: "1.0.0" } },
    };

    assert.deepEqual(productionDependencyClosure(lockfile), ["node_modules/underscore", "node_modules/vsc"]);
    assert.deepEqual(validateProductionDependencies(lockfile, options), { packageCount: 2, entrypointCount: 3 });
    files.delete("extension/node_modules/underscore/underscore.js");
    assert.throws(
        () => validateProductionDependencies(lockfile, options),
        /required production package main is missing for underscore/,
    );
    files.add("extension/node_modules/underscore/underscore.js");
    manifests["node_modules/vsc"].dependencies.rogue = "1.0.0";
    assert.throws(
        () => validateProductionDependencies(lockfile, options),
        /declares unlocked production dependency rogue|does not resolve rogue/,
    );
    delete manifests["node_modules/vsc"].dependencies.rogue;
    manifests["node_modules/vsc"].optionalDependencies.underscore = "1.0.0";
    assert.throws(
        () => validateProductionDependencies(lockfile, options),
        /optionalDependencies.*underscore|required dependencies.*underscore|does not reach locked production package/,
    );
});

test("requires repository, packaged manifest, VSIX identity, and filename agreement", async () => {
    const { validateManifestAgreement } = await import(verifierUrl);
    const repositoryManifest = { name: "vscode-leetnotion", publisher: "Leetnotion", version: "1.5.4" };
    const packagedManifest = { ...repositoryManifest };
    const vsixManifestText = '<PackageManifest><Metadata><Identity Id="vscode-leetnotion" Publisher="Leetnotion" Version="1.5.4" /></Metadata></PackageManifest>';
    const valid = {
        artifactFileName: "vscode-leetnotion-1.5.4.vsix",
        packagedManifest,
        repositoryManifest,
        vsixManifestText,
    };
    assert.doesNotThrow(() => validateManifestAgreement(valid));
    assert.throws(
        () => validateManifestAgreement({ ...valid, packagedManifest: { ...packagedManifest, version: "9.9.9" } }),
        /packaged package\.json version/,
    );
    assert.throws(
        () => validateManifestAgreement({ ...valid, vsixManifestText: vsixManifestText.replace("Leetnotion", "Other") }),
        /Identity Publisher/,
    );
    assert.throws(
        () => validateManifestAgreement({ ...valid, artifactFileName: "wrong.vsix" }),
        /VSIX filename/,
    );
    assert.throws(
        () => validateManifestAgreement({
            ...valid,
            vsixManifestText: `<PackageManifest><Metadata><![CDATA[${vsixManifestText}]]></Metadata></PackageManifest>`,
        }),
        /exactly one Identity element; found 0/,
    );
    assert.throws(
        () => validateManifestAgreement({
            ...valid,
            vsixManifestText: `<PackageManifest><Foo><Metadata>${vsixManifestText}</Metadata></Foo></PackageManifest>`,
        }),
        /Metadata must be a direct child of PackageManifest/,
    );
    assert.throws(
        () => validateManifestAgreement({
            ...valid,
            vsixManifestText: `${vsixManifestText.replace("</PackageManifest>", "<Metadata /></PackageManifest>")}`,
        }),
        /exactly one direct Metadata element; found 2/,
    );
});

test("checks the VSIX size before reading and verifies stored-entry CRC-32", async () => {
    const { calculateCrc32, readBoundedVsix, readZipEntry } = await import(verifierUrl);
    let readCalled = false;
    await assert.rejects(
        readBoundedVsix("oversized.vsix", {
            statFile: async () => ({ size: 15 * 1024 * 1024 + 1 }),
            readFileBytes: async () => {
                readCalled = true;
                return Buffer.alloc(0);
            },
        }),
        /VSIX size/,
    );
    assert.equal(readCalled, false);

    const content = Buffer.from("123456789");
    const name = "extension/file.txt";
    const nameBytes = Buffer.from(name);
    const crc32 = calculateCrc32(content);
    assert.equal(crc32, 0xcbf43926);
    const archive = Buffer.alloc(30 + nameBytes.length + content.length);
    archive.writeUInt32LE(0x04034b50, 0);
    archive.writeUInt16LE(0, 6);
    archive.writeUInt16LE(0, 8);
    archive.writeUInt32LE(crc32, 14);
    archive.writeUInt32LE(content.length, 18);
    archive.writeUInt32LE(content.length, 22);
    archive.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(archive, 30);
    content.copy(archive, 30 + nameBytes.length);
    const entry = {
        name,
        flags: 0,
        compressionMethod: 0,
        compressedSize: content.length,
        uncompressedSize: content.length,
        localHeaderOffset: 0,
        crc32,
    };
    assert.deepEqual(readZipEntry(archive, entry), content);
    const corrupted = Buffer.from(archive);
    corrupted[corrupted.length - 1] ^= 1;
    assert.throws(() => readZipEntry(corrupted, entry), /CRC-32 mismatch/);
});

test("requires the packaged NeetCode index bytes and content set to match exactly", async () => {
    const { validateNeetCodeSnapshot } = await import(verifierUrl);
    const indexBytes = Buffer.from(JSON.stringify({
        problems: {
            "1": { contentFile: "neetcode-content/1.json" },
            "2": {},
        },
    }));
    const indexedEntries = [{ name: "extension/data/neetcode-content/1.json" }];
    assert.doesNotThrow(() => validateNeetCodeSnapshot(indexBytes, Buffer.from(indexBytes), indexedEntries));
    assert.throws(
        () => validateNeetCodeSnapshot(indexBytes, Buffer.from(`${indexBytes.toString("utf8")}\n`), indexedEntries),
        /does not exactly match/,
    );
    assert.throws(
        () => validateNeetCodeSnapshot(indexBytes, Buffer.from(indexBytes), [
            ...indexedEntries,
            { name: "extension/data/neetcode-content/999.json" },
        ]),
        /extra: extension\/data\/neetcode-content\/999\.json/,
    );
});

test("vscodeignore excludes first-party source and build inputs but keeps runtime data and output", () => {
    const ignored = fs.readFileSync(path.join(repositoryRoot, ".vscodeignore"), "utf8").split(/\r?\n/);
    for (const requiredIgnore of ["src/**", "scripts/**", "test/**", "docs", ".git", ".git/**", ".github/**", "**/*.map", "package-lock.json", "tsconfig.json", "esbuild.js"]) {
        assert.ok(ignored.includes(requiredIgnore), `${requiredIgnore} must be ignored`);
    }
    for (const runtimePath of ["out/**", "data/**", "public/**", "resources/**", "node_modules/**"]) {
        assert.equal(ignored.includes(runtimePath), false, `${runtimePath} must remain packageable`);
    }
});
