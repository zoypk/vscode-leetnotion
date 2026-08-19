const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..", "..");

async function readJson(relativePath) {
    return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

test("manifest preserves identity and publishes the fork metadata", async () => {
    const manifest = await readJson("package.json");

    assert.equal(manifest.name, "vscode-leetnotion");
    assert.equal(manifest.publisher, "Leetnotion");
    assert.equal(manifest.version, "1.6.0");
    assert.deepEqual(manifest.repository, {
        type: "git",
        url: "https://github.com/zoypk/vscode-leetnotion",
    });
    assert.equal(manifest.homepage, "https://github.com/zoypk/vscode-leetnotion#readme");
    assert.equal(manifest.engines.vscode, "^1.74.0");
    assert.equal(Object.hasOwn(manifest, "activationEvents"), false,
        "VS Code 1.74 derives activation from contributed commands and views");
});

test("release identity is consistent across manifest, lockfile, and documented artifact", async () => {
    const [manifest, lockfile, readme] = await Promise.all([
        readJson("package.json"),
        readJson("package-lock.json"),
        readFile(path.join(repositoryRoot, "README.md"), "utf8"),
    ]);
    const expectedTag = `v${manifest.version}`;
    const expectedArtifact = `${manifest.name}-${manifest.version}.vsix`;
    const expectedInstalled = `${manifest.publisher}.${manifest.name}@${manifest.version}`;

    assert.equal(lockfile.version, manifest.version);
    assert.equal(lockfile.packages[""].version, manifest.version);
    assert.equal(lockfile.packages[""].engines.vscode, manifest.engines.vscode);
    assert.match(readme, new RegExp(expectedTag.replaceAll(".", "\\.")));
    assert.match(readme, new RegExp(expectedArtifact.replaceAll(".", "\\.")));
    assert.equal(expectedInstalled, "Leetnotion.vscode-leetnotion@1.6.0");
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
    assert.ok(tasks.tasks.some((taskDefinition) => taskDefinition.label === launch.configurations[0].preLaunchTask));
});

test("README covers operating, storage, provenance, diagnostics, and safe-test boundaries", async () => {
    const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");

    for (const requiredText of [
        "Install or upgrade",
        "Stop Session",
        "SecretStorage",
        "global storage",
        "Data refresh and provenance",
        "Diagnostics",
        "must not make live LeetCode submissions",
        "write to a real Notion workspace",
    ]) {
        assert.match(readme, new RegExp(requiredText, "i"));
    }
});
