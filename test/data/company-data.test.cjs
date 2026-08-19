const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const fixtureRoot = path.join(repositoryRoot, "test", "fixtures", "company-data");
const sourceFixture = path.join(fixtureRoot, "source");
const provenance = {
    schemaVersion: 1,
    sourceRepository: "https://github.com/liquidslr/leetcode-company-wise-problems",
    sourceRevision: "03850eb5d16892514491cf1381c32ec0330a2719",
    generatedAt: "2026-08-19T00:00:00.000Z",
    counts: { companies: 2, questions: 3, memberships: 4 },
};

async function modules() {
    const company = await import(pathToFileURL(path.join(repositoryRoot, "scripts", "sync-company-data.mjs")));
    const validation = await import(pathToFileURL(path.join(repositoryRoot, "scripts", "lib", "data-validation.mjs")));
    const sync = await import(pathToFileURL(path.join(repositoryRoot, "scripts", "lib", "sync-utils.mjs")));
    return { company, validation, sync };
}

function slugMap() {
    return new Map([["two-sum", "1"], ["group-anagrams", "49"], ["valid-anagram", "242"]]);
}

test("reverse mappings are the deduplicated union of all five windows", async () => {
    const { company, validation } = await modules();
    const dataset = company.buildCompanyData(sourceFixture, slugMap());
    assert.deepEqual(dataset.companyTags.Alpha["Last 30 Days"], ["1"]);
    assert.deepEqual(dataset.questionCompanyTags, {
        "1": ["Alpha"],
        "49": ["Alpha", "Beta"],
        "242": ["Alpha"],
    });
    assert.deepEqual(validation.validateCompanyDataset(
        dataset.companyTags, dataset.questionCompanyTags, provenance,
    ), {
        companies: 2, questions: 3, memberships: 4, forwardGaps: 0, reverseGaps: 0,
    });
});

test("missing and malformed company CSV files fail with their path and row", async () => {
    const { company } = await modules();
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "company-data-fixture-"));
    try {
        cpSync(sourceFixture, temporaryRoot, { recursive: true });
        const missing = path.join(temporaryRoot, "Alpha", "3. Six Months.csv");
        rmSync(missing);
        assert.throws(() => company.buildCompanyData(temporaryRoot, slugMap()), /Missing company CSV:.*Six Months/);

        cpSync(sourceFixture, temporaryRoot, { recursive: true, force: true });
        const malformed = path.join(temporaryRoot, "Alpha", "3. Six Months.csv");
        writeFileSync(malformed, "Difficulty,Title,Link\nEasy,Bad,not-a-url\n");
        assert.throws(() => company.buildCompanyData(temporaryRoot, slugMap()), /Invalid LeetCode problem link.*row 2/);
    } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test("unmapped slugs fail instead of silently dropping forward membership", async () => {
    const { company } = await modules();
    const incompleteMap = slugMap();
    incompleteMap.delete("valid-anagram");
    assert.throws(
        () => company.buildCompanyData(sourceFixture, incompleteMap),
        /Could not map 1 problem slug.*valid-anagram/,
    );
});

test("validator reports reverse gaps, extras, duplicates, and unstable sort order", async () => {
    const { company, validation } = await modules();
    const dataset = company.buildCompanyData(sourceFixture, slugMap());
    const brokenReverse = {
        "242": ["Alpha", "Alpha", "Ghost"],
        "49": ["Beta", "Alpha"],
    };
    assert.throws(
        () => validation.validateCompanyDataset(dataset.companyTags, brokenReverse, provenance),
        (error) => /Reverse entry 49 are not in deterministic sort order/.test(error.message)
            && /has extras: Ghost/.test(error.message)
            && /contains duplicate companies/.test(error.message)
            && /missing question 1/.test(error.message),
    );
});

test("validator rejects unsorted forward company names", async () => {
    const { company, validation } = await modules();
    const dataset = company.buildCompanyData(sourceFixture, slugMap());
    const reversed = {
        Beta: dataset.companyTags.Beta,
        Alpha: dataset.companyTags.Alpha,
    };
    assert.throws(
        () => validation.validateCompanyDataset(reversed, dataset.questionCompanyTags, provenance),
        /companyTags company names are not in deterministic sort order/,
    );
});

test("validator rejects unexpected reverse question IDs even when their company list is empty", async () => {
    const { company, validation } = await modules();
    const dataset = company.buildCompanyData(sourceFixture, slugMap());
    const reverseWithEmptyExtra = { ...dataset.questionCompanyTags, "9999": [] };
    assert.throws(
        () => validation.validateCompanyDataset(dataset.companyTags, reverseWithEmptyExtra),
        /Reverse mapping has unexpected question 9999/,
    );
});

test("validator requires canonical positive decimal question IDs", async () => {
    const { company, validation } = await modules();
    const dataset = company.buildCompanyData(sourceFixture, slugMap());
    for (const invalidId of [" 1", "1 ", "01", "-1", "abc"]) {
        const invalidForward = structuredClone(dataset.companyTags);
        invalidForward.Alpha["Last 30 Days"] = [invalidId];
        assert.throws(
            () => validation.validateCompanyDataset(invalidForward, dataset.questionCompanyTags),
            /must be a canonical positive decimal question ID/,
            `forward ID ${JSON.stringify(invalidId)} should fail`,
        );
        const invalidReverse = { ...dataset.questionCompanyTags, [invalidId]: [] };
        assert.throws(
            () => validation.validateCompanyDataset(dataset.companyTags, invalidReverse),
            /must be a canonical positive decimal question ID/,
            `reverse ID ${JSON.stringify(invalidId)} should fail`,
        );
    }
});

test("production floors and provenance counts reject consistently truncated data", async () => {
    const { company, validation } = await modules();
    const dataset = company.buildCompanyData(sourceFixture, slugMap());
    assert.throws(
        () => validation.validateCompanyDataset(dataset.companyTags, dataset.questionCompanyTags, provenance, {
            minimums: validation.COMPANY_PRODUCTION_MINIMUMS,
        }),
        /companies count 2 is below production minimum 400/,
    );
    const incorrectProvenance = {
        ...provenance,
        counts: { ...provenance.counts, memberships: 3 },
    };
    assert.throws(
        () => validation.validateCompanyDataset(dataset.companyTags, dataset.questionCompanyTags, incorrectProvenance),
        /provenance memberships count 3 does not match 4/,
    );
});

test("source-dir provenance uses a clean checkout at the live revision", async () => {
    const { company } = await modules();
    const sourceRoot = mkdtempSync(path.join(tmpdir(), "company-source-checkout-"));
    try {
        execFileSync("git", ["init", "--quiet", sourceRoot]);
        execFileSync("git", ["-C", sourceRoot, "config", "user.email", "tests@example.com"]);
        execFileSync("git", ["-C", sourceRoot, "config", "user.name", "Company Data Tests"]);
        execFileSync("git", ["-C", sourceRoot, "config", "core.autocrlf", "false"]);
        writeFileSync(path.join(sourceRoot, "source.txt"), "committed\n");
        execFileSync("git", ["-C", sourceRoot, "add", "source.txt"]);
        execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "fixture"]);
        const revision = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        assert.equal(company.verifyCurrentSourceCheckout(sourceRoot, revision), revision);
        assert.throws(
            () => company.verifyCurrentSourceCheckout(sourceRoot, "0".repeat(40)),
            /source checkout is at .* live main is 000000/,
        );
        const generated = company.createCompanyProvenance(revision, {
            companies: 2, questions: 3, memberships: 4,
        }, "2026-08-19T00:00:00.000Z");
        assert.equal(generated.sourceRevision, revision);
        assert.deepEqual(generated.counts, { companies: 2, questions: 3, memberships: 4 });

        writeFileSync(path.join(sourceRoot, "source.txt"), "modified\n");
        assert.throws(
            () => company.verifyCurrentSourceCheckout(sourceRoot, revision),
            /uncommitted or untracked changes/,
        );
    } finally {
        rmSync(sourceRoot, { recursive: true, force: true });
    }
});

test("failed staged validation preserves all prior outputs", async () => {
    const { sync } = await modules();
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "company-output-"));
    const first = path.join(temporaryRoot, "companyTags.json");
    const second = path.join(temporaryRoot, "questionCompanyTags.json");
    try {
        writeFileSync(first, "old-forward");
        writeFileSync(second, "old-reverse");
        assert.throws(() => sync.atomicWriteFiles([
            { path: first, content: "new-forward" },
            { path: second, content: "new-reverse" },
        ], { validate: () => { throw new Error("invalid staged data"); } }), /invalid staged data/);
        assert.equal(readFileSync(first, "utf8"), "old-forward");
        assert.equal(readFileSync(second, "utf8"), "old-reverse");
    } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
    }
});
