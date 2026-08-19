const assert = require("node:assert/strict");
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
