import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { validateCompanyDataset } from "./data-validation.mjs";
import { atomicReplaceFile } from "./sync-utils.mjs";

export const COMPANY_BUNDLE_FILE = "company-data.json";
export const COMPANY_PUBLICATION_JOURNAL_FILE = ".company-data-publication.json";

const SIDECAR_FILES = Object.freeze({
    companyTags: "companyTags.json",
    questionCompanyTags: "questionCompanyTags.json",
    provenance: "company-data-provenance.json",
});

export function createCompanyGeneration(companyTags, questionCompanyTags, provenance) {
    return {
        bundle: `${JSON.stringify({
            schemaVersion: 1,
            companyTags,
            questionCompanyTags,
            provenance,
        })}\n`,
        companyTags: `${JSON.stringify(companyTags)}\n`,
        questionCompanyTags: `${JSON.stringify(questionCompanyTags)}\n`,
        provenance: `${JSON.stringify(provenance, null, 2)}\n`,
    };
}

export function validateCompanyGeneration(generation, validationOptions = {}) {
    if (!generation || typeof generation !== "object") {
        throw new Error("Company publication generation is missing");
    }
    const expectedKeys = ["bundle", "companyTags", "provenance", "questionCompanyTags"];
    if (Object.keys(generation).sort().join(",") !== expectedKeys.join(",")
        || expectedKeys.some((key) => typeof generation[key] !== "string")) {
        throw new Error("Company publication generation has an invalid shape");
    }
    const bundle = parseJson(generation.bundle, COMPANY_BUNDLE_FILE);
    const companyTags = parseJson(generation.companyTags, SIDECAR_FILES.companyTags);
    const questionCompanyTags = parseJson(
        generation.questionCompanyTags,
        SIDECAR_FILES.questionCompanyTags,
    );
    const provenance = parseJson(generation.provenance, SIDECAR_FILES.provenance);
    if (!bundle || bundle.schemaVersion !== 1) {
        throw new Error("Company data bundle must use schema version 1");
    }
    if (!jsonEqual(bundle.companyTags, companyTags)
        || !jsonEqual(bundle.questionCompanyTags, questionCompanyTags)
        || !jsonEqual(bundle.provenance, provenance)) {
        throw new Error("Company compatibility sidecars do not match the authoritative bundle");
    }
    return validateCompanyDataset(
        bundle.companyTags,
        bundle.questionCompanyTags,
        bundle.provenance,
        validationOptions,
    );
}

export function publishCompanyGeneration(outputDirectory, generation, options = {}) {
    recoverCompanyPublication(outputDirectory, options);
    validateCompanyGeneration(generation, options.validationOptions);
    const journalPath = join(outputDirectory, COMPANY_PUBLICATION_JOURNAL_FILE);
    const journal = `${JSON.stringify({ schemaVersion: 1, generation })}\n`;
    atomicReplaceFile(journalPath, journal, {
        validate: (stagedPath) => parseJournal(readFileSync(stagedPath, "utf8"), options),
    });
    options.onCheckpoint?.("journal-written");

    installGeneration(outputDirectory, generation, options);
    options.onCheckpoint?.("before-journal-delete");
    rmSync(journalPath, { force: true });
}

export function recoverCompanyPublication(outputDirectory, options = {}) {
    const journalPath = join(outputDirectory, COMPANY_PUBLICATION_JOURNAL_FILE);
    if (!existsSync(journalPath)) {
        return false;
    }
    const journal = parseJournal(readFileSync(journalPath, "utf8"), options);
    installGeneration(outputDirectory, journal.generation, {
        validationOptions: options.validationOptions,
    });
    rmSync(journalPath, { force: true });
    return true;
}

export function validatePublishedCompanyData(outputDirectory, validationOptions = {}) {
    const journalPath = join(outputDirectory, COMPANY_PUBLICATION_JOURNAL_FILE);
    if (existsSync(journalPath)) {
        throw new Error(
            `Company data has an unfinished publication journal at ${journalPath}; run the company sync to recover it`,
        );
    }
    const paths = publicationPaths(outputDirectory);
    const generation = {
        bundle: readFileSync(paths.bundle, "utf8"),
        companyTags: readFileSync(paths.companyTags, "utf8"),
        questionCompanyTags: readFileSync(paths.questionCompanyTags, "utf8"),
        provenance: readFileSync(paths.provenance, "utf8"),
    };
    return validateCompanyGeneration(generation, validationOptions);
}

function installGeneration(outputDirectory, generation, options) {
    validateCompanyGeneration(generation, options.validationOptions);
    const paths = publicationPaths(outputDirectory);
    atomicReplaceFile(paths.bundle, generation.bundle);
    options.onCheckpoint?.("bundle-published");
    for (const sidecarName of Object.keys(SIDECAR_FILES)) {
        atomicReplaceFile(paths[sidecarName], generation[sidecarName]);
        options.onCheckpoint?.(`sidecar-${sidecarName}-published`);
    }
}

function parseJournal(rawJournal, options) {
    const journal = parseJson(rawJournal, COMPANY_PUBLICATION_JOURNAL_FILE);
    if (!journal || journal.schemaVersion !== 1) {
        throw new Error("Company publication journal must use schema version 1");
    }
    validateCompanyGeneration(journal.generation, options.validationOptions);
    return journal;
}

function publicationPaths(outputDirectory) {
    return {
        bundle: join(outputDirectory, COMPANY_BUNDLE_FILE),
        companyTags: join(outputDirectory, SIDECAR_FILES.companyTags),
        questionCompanyTags: join(outputDirectory, SIDECAR_FILES.questionCompanyTags),
        provenance: join(outputDirectory, SIDECAR_FILES.provenance),
    };
}

function parseJson(raw, description) {
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Could not parse ${description}: ${error.message}`);
    }
}

function jsonEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
