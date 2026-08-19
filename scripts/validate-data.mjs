import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANY_PRODUCTION_MINIMUMS, validateCompanyDataset } from "./lib/data-validation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
    try {
        return JSON.parse(readFileSync(join(repositoryRoot, relativePath), "utf8"));
    } catch (error) {
        throw new Error(`Could not read ${relativePath}: ${error.message}`);
    }
}

const companyStats = validateCompanyDataset(
    readJson("data/companyTags.json"),
    readJson("data/questionCompanyTags.json"),
    readJson("data/company-data-provenance.json"),
    { minimums: COMPANY_PRODUCTION_MINIMUMS },
);
console.log(
    `Company data valid: ${companyStats.companies} companies, ${companyStats.questions} questions, `
    + `${companyStats.memberships} memberships; forward/reverse gaps: 0/0.`,
);
