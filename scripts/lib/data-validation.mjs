export const COMPANY_WINDOWS = [
    "Last 30 Days", "Last 3 Months", "Last 6 Months", "More Than 6 Months", "All Time",
];

export function compareNames(left, right) {
    return left.localeCompare(right, "en", { sensitivity: "variant" });
}

export function compareQuestionIds(left, right) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
        ? leftNumber - rightNumber
        : compareNames(left, right);
}

export function validateCompanyDataset(companyTags, questionCompanyTags, provenance) {
    const errors = [];
    if (!isPlainObject(companyTags)) { throw new Error("companyTags.json must contain a JSON object"); }
    if (!isPlainObject(questionCompanyTags)) { throw new Error("questionCompanyTags.json must contain a JSON object"); }
    const companyNames = Object.keys(companyTags);
    assertOrdered(companyNames, compareNames, "companyTags company names", errors);
    const expectedReverse = new Map();
    let forwardMemberships = 0;
    for (const companyName of companyNames) {
        const details = companyTags[companyName];
        if (!isPlainObject(details)) {
            errors.push(`Company ${companyName} must map to an object`);
            continue;
        }
        const keys = Object.keys(details);
        if (keys.length !== COMPANY_WINDOWS.length || COMPANY_WINDOWS.some((window) => !keys.includes(window))) {
            errors.push(`Company ${companyName} must contain exactly: ${COMPANY_WINDOWS.join(", ")}`);
        }
        const companyQuestionIds = new Set();
        for (const window of COMPANY_WINDOWS) {
            const questionIds = details[window];
            if (!Array.isArray(questionIds)) {
                errors.push(`Company ${companyName} window ${window} must be an array`);
                continue;
            }
            const seen = new Set();
            for (const questionId of questionIds) {
                if (typeof questionId !== "string" || questionId.length === 0) {
                    errors.push(`Company ${companyName} window ${window} contains a non-string question ID`);
                } else if (seen.has(questionId)) {
                    errors.push(`Company ${companyName} window ${window} repeats question ${questionId}`);
                } else {
                    seen.add(questionId);
                    companyQuestionIds.add(questionId);
                }
            }
        }
        for (const questionId of companyQuestionIds) {
            if (!expectedReverse.has(questionId)) { expectedReverse.set(questionId, []); }
            expectedReverse.get(questionId).push(companyName);
            forwardMemberships += 1;
        }
    }

    const reverseQuestionIds = Object.keys(questionCompanyTags);
    assertOrdered(reverseQuestionIds, compareQuestionIds, "questionCompanyTags question IDs", errors);
    for (const questionId of reverseQuestionIds) {
        const companies = questionCompanyTags[questionId];
        if (!Array.isArray(companies) || companies.some((company) => typeof company !== "string")) {
            errors.push(`Reverse entry ${questionId} must be an array of company names`);
            continue;
        }
        if (new Set(companies).size !== companies.length) {
            errors.push(`Reverse entry ${questionId} contains duplicate companies`);
        }
        assertOrdered(companies, compareNames, `Reverse entry ${questionId}`, errors);
        const expected = (expectedReverse.get(questionId) ?? []).sort(compareNames);
        const actual = [...companies].sort(compareNames);
        const missing = expected.filter((company) => !actual.includes(company));
        const extras = actual.filter((company) => !expected.includes(company));
        if (missing.length > 0) { errors.push(`Reverse entry ${questionId} is missing: ${missing.join(", ")}`); }
        if (extras.length > 0) { errors.push(`Reverse entry ${questionId} has extras: ${extras.join(", ")}`); }
    }
    for (const [questionId, companies] of expectedReverse) {
        if (!Object.prototype.hasOwnProperty.call(questionCompanyTags, questionId)) {
            errors.push(`Reverse mapping is missing question ${questionId} (${companies.sort(compareNames).join(", ")})`);
        }
    }
    if (provenance !== undefined && (!isPlainObject(provenance)
        || provenance.schemaVersion !== 1
        || provenance.sourceRepository !== "https://github.com/liquidslr/leetcode-company-wise-problems"
        || typeof provenance.sourceRevision !== "string"
        || !/^[0-9a-f]{40}$/.test(provenance.sourceRevision)
        || typeof provenance.generatedAt !== "string"
        || Number.isNaN(Date.parse(provenance.generatedAt)))) {
        errors.push("Company data provenance is malformed");
    }
    if (errors.length > 0) {
        throw new Error(`Company data validation failed (${errors.length} issue(s)):\n- ${errors.join("\n- ")}`);
    }
    return {
        companies: companyNames.length,
        questions: reverseQuestionIds.length,
        memberships: forwardMemberships,
        forwardGaps: 0,
        reverseGaps: 0,
    };
}

function assertOrdered(values, compare, description, errors) {
    const expected = [...values].sort(compare);
    if (values.some((value, index) => value !== expected[index])) {
        errors.push(`${description} are not in deterministic sort order`);
    }
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
