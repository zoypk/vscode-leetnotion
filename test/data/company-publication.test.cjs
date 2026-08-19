const assert = require("node:assert/strict");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "..", "..");

async function modules() {
    const publication = await import(pathToFileURL(
        path.join(repositoryRoot, "scripts", "lib", "company-publication.mjs"),
    ));
    const validation = await import(pathToFileURL(
        path.join(repositoryRoot, "scripts", "lib", "data-validation.mjs"),
    ));
    return { publication, validation };
}

function dataset(revisionDigit, includeSecondQuestion) {
    const emptyDetails = {
        "Last 30 Days": ["1"],
        "Last 3 Months": includeSecondQuestion ? ["49"] : [],
        "Last 6 Months": [],
        "More Than 6 Months": [],
        "All Time": ["1"],
    };
    const companyTags = { Alpha: emptyDetails };
    const questionCompanyTags = includeSecondQuestion
        ? { "1": ["Alpha"], "49": ["Alpha"] }
        : { "1": ["Alpha"] };
    const provenance = {
        schemaVersion: 1,
        sourceRepository: "https://github.com/liquidslr/leetcode-company-wise-problems",
        sourceRevision: revisionDigit.repeat(40),
        generatedAt: "2026-08-19T00:00:00.000Z",
        counts: {
            companies: 1,
            questions: includeSecondQuestion ? 2 : 1,
            memberships: includeSecondQuestion ? 2 : 1,
        },
    };
    return { companyTags, questionCompanyTags, provenance };
}

test("every interrupted publication keeps the runtime bundle coherent and recovers all sidecars", async (t) => {
    const { publication, validation } = await modules();
    const checkpoints = [
        "journal-written",
        "bundle-published",
        "sidecar-companyTags-published",
        "sidecar-questionCompanyTags-published",
        "sidecar-provenance-published",
        "before-journal-delete",
    ];
    for (const checkpoint of checkpoints) {
        await t.test(checkpoint, () => {
            const outputDirectory = fs.mkdtempSync(path.join(tmpdir(), "company-publication-"));
            const oldDataset = dataset("1", false);
            const newDataset = dataset("2", true);
            const oldGeneration = publication.createCompanyGeneration(
                oldDataset.companyTags, oldDataset.questionCompanyTags, oldDataset.provenance,
            );
            const newGeneration = publication.createCompanyGeneration(
                newDataset.companyTags, newDataset.questionCompanyTags, newDataset.provenance,
            );
            try {
                publication.publishCompanyGeneration(outputDirectory, oldGeneration);
                assert.throws(() => publication.publishCompanyGeneration(outputDirectory, newGeneration, {
                    onCheckpoint: (reached) => {
                        if (reached === checkpoint) {
                            throw new Error(`simulated interruption at ${checkpoint}`);
                        }
                    },
                }), new RegExp(`simulated interruption at ${checkpoint}`));

                const bundle = JSON.parse(fs.readFileSync(
                    path.join(outputDirectory, publication.COMPANY_BUNDLE_FILE), "utf8",
                ));
                validation.validateCompanyDataset(
                    bundle.companyTags, bundle.questionCompanyTags, bundle.provenance,
                );
                assert.ok(
                    ["1".repeat(40), "2".repeat(40)].includes(bundle.provenance.sourceRevision),
                    "runtime bundle must be one complete old or new generation",
                );

                assert.equal(publication.recoverCompanyPublication(outputDirectory), true);
                const stats = publication.validatePublishedCompanyData(outputDirectory);
                assert.deepEqual(stats, {
                    companies: 1, questions: 2, memberships: 2, forwardGaps: 0, reverseGaps: 0,
                });
                const recoveredBundle = JSON.parse(fs.readFileSync(
                    path.join(outputDirectory, publication.COMPANY_BUNDLE_FILE), "utf8",
                ));
                assert.equal(recoveredBundle.provenance.sourceRevision, "2".repeat(40));
                assert.equal(
                    fs.existsSync(path.join(outputDirectory, publication.COMPANY_PUBLICATION_JOURNAL_FILE)),
                    false,
                );
            } finally {
                fs.rmSync(outputDirectory, { recursive: true, force: true });
            }
        });
    }
});

test("published-data validation rejects sidecars from a different generation", async () => {
    const { publication } = await modules();
    const outputDirectory = fs.mkdtempSync(path.join(tmpdir(), "company-sidecar-mismatch-"));
    const current = dataset("1", false);
    try {
        publication.publishCompanyGeneration(outputDirectory, publication.createCompanyGeneration(
            current.companyTags, current.questionCompanyTags, current.provenance,
        ));
        fs.writeFileSync(path.join(outputDirectory, "questionCompanyTags.json"), "{}\n");
        assert.throws(
            () => publication.validatePublishedCompanyData(outputDirectory),
            /compatibility sidecars do not match the authoritative bundle/,
        );
    } finally {
        fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
});
