import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANY_PRODUCTION_MINIMUMS, validateNeetCodeDataset } from "./lib/data-validation.mjs";
import { validatePublishedCompanyData } from "./lib/company-publication.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
    return JSON.parse(readFileSync(join(repositoryRoot, relativePath), "utf8"));
}

const companyStats = validatePublishedCompanyData(
    join(repositoryRoot, "data"),
    { minimums: COMPANY_PRODUCTION_MINIMUMS },
);
console.log(
    `Company data valid: ${companyStats.companies} companies, ${companyStats.questions} questions, `
    + `${companyStats.memberships} memberships; forward/reverse gaps: 0/0.`,
);

const neetCodeIndex = readJson("data/neetcode-index.json");
const neetCodeContents = new Map();
for (const fileName of readdirSync(join(repositoryRoot, "data", "neetcode-content"))) {
    if (fileName.endsWith(".json")) {
        const relativePath = `neetcode-content/${fileName}`;
        neetCodeContents.set(relativePath, readJson(`data/${relativePath}`));
    }
}
const neetCodeStats = validateNeetCodeDataset(neetCodeIndex, neetCodeContents);
console.log(
    `NeetCode data valid: ${neetCodeStats.problemCount} problems, ${neetCodeStats.contentFileCount} content files, `
    + `${neetCodeStats.neetcode150Count} NeetCode 150 and ${neetCodeStats.blind75Count} Blind 75 entries.`,
);
