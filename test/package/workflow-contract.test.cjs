const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const repositoryRoot = path.resolve(__dirname, "..", "..");

async function readWorkflow(name) {
    const text = await readFile(path.join(repositoryRoot, ".github", "workflows", name), "utf8");
    assert.equal(text.includes("\t"), false, `${name} must not contain tabs`);
    return {
        document: yaml.safeLoad(text, { schema: yaml.JSON_SCHEMA }),
        text,
    };
}

function onlyJob(workflow) {
    assert.equal(typeof workflow.jobs, "object");
    const jobs = Object.values(workflow.jobs);
    assert.equal(jobs.length, 1);
    return jobs[0];
}

function runCommands(job) {
    return job.steps.filter((step) => typeof step.run === "string").map((step) => step.run);
}

function assertSharedVerificationScript(manifest) {
    assert.equal(
        manifest.scripts.verify,
        "npm run typecheck && npm run lint && npm test && npm run validate:data && npm run compile",
    );
}

test("CI runs the shared local gates for pull requests and main before uploading the VSIX", async () => {
    const { document: workflow } = await readWorkflow("ci.yml");
    const manifest = require("../../package.json");
    assertSharedVerificationScript(manifest);

    assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "push"]);
    assert.deepEqual(workflow.on.push.branches, ["main"]);
    assert.equal(workflow.permissions.contents, "read");

    const job = onlyJob(workflow);
    const commands = runCommands(job);
    assert.deepEqual(commands, [
        "npm ci",
        "npm run verify",
        "npm run package",
        "npm run verify:vsix",
        "npm test -- test/package/manifest.test.cjs",
    ]);

    const upload = job.steps.find((step) => step.uses === "actions/upload-artifact@v4");
    assert.ok(upload, "CI must upload its validated artifact");
    assert.equal(upload.with.path, "vscode-leetnotion-*.vsix");
    assert.equal(upload.with["if-no-files-found"], "error");
});

test("release runs only for semantic version tags and rejects manifest drift", async () => {
    const { document: workflow, text } = await readWorkflow("release.yml");

    assert.deepEqual(Object.keys(workflow.on), ["push"]);
    assert.deepEqual(workflow.on.push.tags, ["v*.*.*"]);
    assert.equal(Object.hasOwn(workflow.on.push, "branches"), false);
    assert.equal(text.includes("workflow_dispatch"), false);
    assert.equal(workflow.permissions.contents, "write");

    const job = onlyJob(workflow);
    const contract = job.steps.find((step) => step.id === "contract");
    assert.ok(contract, "release must have a version contract step");
    assert.match(contract.run, /require\('\.\/package\.json'\)\.version/);
    assert.match(contract.run, /expected_tag="v\$\{package_version\}"/);
    assert.match(contract.run, /GITHUB_REF_NAME/);
    assert.match(contract.run, /artifact="vscode-leetnotion-\$\{package_version\}\.vsix"/);
    assert.match(contract.run, /artifact=\$\{artifact\}.*GITHUB_OUTPUT/s);
});

test("release validates and publishes one exact artifact without prerelease churn", async () => {
    const { document: workflow, text } = await readWorkflow("release.yml");
    const manifest = require("../../package.json");
    assertSharedVerificationScript(manifest);
    const job = onlyJob(workflow);
    const commands = runCommands(job);
    const artifactExpression = "${{ steps.contract.outputs.artifact }}";

    for (const command of [
        "npm ci",
        "npm run verify",
        "npm run package",
        `npm run verify:vsix -- "${artifactExpression}"`,
        "npm test -- test/package/manifest.test.cjs",
    ]) {
        assert.ok(commands.includes(command), `release must run ${command}`);
    }
    assert.equal(commands.filter((command) => command === "npm run package").length, 1);

    const upload = job.steps.find((step) => step.uses === "actions/upload-artifact@v4");
    const release = job.steps.find((step) => step.uses === "softprops/action-gh-release@v2");
    assert.equal(upload.with.path, artifactExpression);
    assert.equal(upload.with["if-no-files-found"], "error");
    assert.equal(release.with.files, artifactExpression);
    assert.equal(release.with["fail_on_unmatched_files"], true);
    assert.equal(release.with.prerelease, false);
    assert.equal(text.includes("main-${{"), false);
    assert.equal(text.includes("prerelease: true"), false);
    assert.equal(text.includes("vsce package"), false);
});
