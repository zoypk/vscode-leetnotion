const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..", "..");

async function readJson(relativePath) {
    return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

test("manifest preserves identity and publishes the fork metadata", async () => {
    const manifest = await readJson("package.json");

    assert.equal(manifest.name, "vscode-leetnotion");
    assert.equal(manifest.publisher, "Leetnotion");
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(manifest.repository, {
        type: "git",
        url: "https://github.com/zoypk/vscode-leetnotion",
    });
    assert.equal(manifest.homepage, "https://github.com/zoypk/vscode-leetnotion#readme");
    assert.equal(manifest.engines.vscode, "^1.74.0");
    assert.deepEqual(manifest.activationEvents, ["onUri"],
        "VS Code 1.74 derives command/view activation; only the independent URI handler is explicit");
});

test("release identity is consistent across manifest, lockfile, and documented artifact", async () => {
    const [manifest, lockfile, readme] = await Promise.all([
        readJson("package.json"),
        readJson("package-lock.json"),
        readFile(path.join(repositoryRoot, "README.md"), "utf8"),
    ]);
    assert.equal(lockfile.version, manifest.version);
    assert.equal(lockfile.packages[""].version, manifest.version);
    assert.equal(lockfile.packages[""].engines.vscode, manifest.engines.vscode);
    assert.match(readme, /v<version>/);
    assert.match(readme, new RegExp(`${manifest.name}-<version>\\.vsix`));
    assert.equal(readme.includes(manifest.version), false,
        "installation documentation must not go stale on the next release");
});

test("built VSIX filename, manifests, installed identity, and release tag agree", async (context) => {
    const manifest = await readJson("package.json");
    const artifactName = `${manifest.name}-${manifest.version}.vsix`;
    const artifactPath = path.join(repositoryRoot, artifactName);
    let archive;
    try {
        archive = await readFile(artifactPath);
    } catch (error) {
        if (error && error.code === "ENOENT") {
            context.skip("run npm run package to exercise the built-artifact contract");
            return;
        }
        throw error;
    }

    const verifier = await import(pathToFileURL(path.join(repositoryRoot, "scripts", "verify-vsix.mjs")));
    const entries = verifier.parseZipEntries(archive);
    const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
    const packagedManifest = JSON.parse(
        verifier.readZipEntry(archive, entryByName.get("extension/package.json")).toString("utf8"),
    );
    const vsixManifestText = verifier.readZipEntry(
        archive,
        entryByName.get("extension.vsixmanifest"),
    ).toString("utf8");

    verifier.validateManifestAgreement({
        artifactFileName: artifactName,
        packagedManifest,
        repositoryManifest: manifest,
        vsixManifestText,
    });
    assert.equal(
        `${packagedManifest.publisher}.${packagedManifest.name}@${packagedManifest.version}`,
        `${manifest.publisher}.${manifest.name}@${manifest.version}`,
        "the identity VS Code installs must match the repository extension version",
    );
    assert.equal(`v${packagedManifest.version}`, `v${manifest.version}`);
});

test("VS Code tasks and launch documents reference existing development scripts", async () => {
    const [manifest, tasks, launch] = await Promise.all([
        readJson("package.json"),
        readJson(path.join(".vscode", "tasks.json")),
        readJson(path.join(".vscode", "launch.json")),
    ]);

    assert.equal(tasks.version, "2.0.0");
    assert.ok(Array.isArray(tasks.tasks) && tasks.tasks.length > 0);
    assert.equal(new Set(tasks.tasks.map((taskDefinition) => taskDefinition.label)).size, tasks.tasks.length);
    for (const taskDefinition of tasks.tasks) {
        assert.equal(taskDefinition.type, "npm");
        assert.equal(typeof manifest.scripts[taskDefinition.script], "string",
            `${taskDefinition.label} must reference a package script`);
    }

    assert.equal(launch.configurations.length, 1);
    assert.equal(launch.configurations[0].name, "Launch Extension");
    assert.equal(launch.configurations.some((configuration) => configuration.name === "Launch Tests"), false);
    const preLaunchTask = tasks.tasks.find(
        (taskDefinition) => taskDefinition.label === launch.configurations[0].preLaunchTask,
    );
    assert.ok(preLaunchTask);
    assert.equal(preLaunchTask.label, "npm: compile");
    assert.notEqual(preLaunchTask.isBackground, true,
        "extension launch must not wait indefinitely for a background task readiness signal");
});

test("README covers operating, storage, provenance, diagnostics, and safe-test boundaries", async () => {
    const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");

    for (const requiredText of [
        "Install or upgrade",
        "Stop Session",
        "SecretStorage",
        "global storage",
        "\\.leetnotion/reviews\\.json",
        "\\.leetnotion/study\\.json",
        "Data refresh and provenance",
        "Diagnostics",
        "must not make live LeetCode submissions",
        "write to a real Notion workspace",
    ]) {
        assert.match(readme, new RegExp(requiredText, "i"));
    }
});
