import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANY_PRODUCTION_MINIMUMS } from "./lib/data-validation.mjs";
import { validatePublishedCompanyData } from "./lib/company-publication.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const companyStats = validatePublishedCompanyData(
    join(repositoryRoot, "data"),
    { minimums: COMPANY_PRODUCTION_MINIMUMS },
);
console.log(
    `Company data valid: ${companyStats.companies} companies, ${companyStats.questions} questions, `
    + `${companyStats.memberships} memberships; forward/reverse gaps: 0/0.`,
);
