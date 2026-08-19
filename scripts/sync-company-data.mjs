import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    atomicWriteFiles,
    checkoutExactRevision,
    downloadText,
    resolveRemoteHead,
    runGit,
} from "./lib/sync-utils.mjs";
import {
    COMPANY_WINDOWS,
    compareNames,
    compareQuestionIds,
    validateCompanyDataset,
} from "./lib/data-validation.mjs";

export const SOURCE_REPOSITORY = "https://github.com/liquidslr/leetcode-company-wise-problems";
const SOURCE_GIT_URL = `${SOURCE_REPOSITORY}.git`;
const LEETCODE_PROBLEMS_URL = "https://leetcode.com/api/problems/all/";
const LEETCODE_PROBLEMS_MAX_BYTES = 25 * 1024 * 1024;
export const WINDOWS = new Map([
    ["1. Thirty Days.csv", "Last 30 Days"],
    ["2. Three Months.csv", "Last 3 Months"],
    ["3. Six Months.csv", "Last 6 Months"],
    ["4. More Than Six Months.csv", "More Than 6 Months"],
    ["5. All.csv", "All Time"],
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

export function parseArguments(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];
        if (["--source-dir", "--problems-file", "--expected-source-revision"].includes(argument)) {
            if (!value || value.startsWith("--")) {
                throw new Error(`${argument} requires a value`);
            }
            if (argument === "--source-dir") {
                options.sourceDirectory = resolve(value);
            } else if (argument === "--problems-file") {
                options.problemsFile = resolve(value);
            } else {
                options.expectedSourceRevision = value.toLowerCase();
            }
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    return options;
}

export async function loadSlugToQuestionId(problemsFile) {
    const body = problemsFile
        ? readFileSync(problemsFile, "utf8")
        : await downloadText(LEETCODE_PROBLEMS_URL, {
            headers: { "User-Agent": "vscode-leetnotion-company-data-sync" },
            maxBytes: LEETCODE_PROBLEMS_MAX_BYTES,
        });
    let payload;
    try {
        payload = JSON.parse(body);
    } catch (error) {
        throw new Error(`Could not parse LeetCode problem data: ${error.message}`);
    }
    const mapping = new Map();
    for (const item of payload.stat_status_pairs ?? []) {
        const slug = item.stat?.question__title_slug;
        const questionId = item.stat?.frontend_question_id;
        if (slug && questionId !== undefined && questionId !== null) {
            mapping.set(slug, String(questionId));
        }
    }
    if (mapping.size === 0) {
        throw new Error("LeetCode problem data did not contain any slug-to-ID mappings");
    }
    return mapping;
}

export function extractProblemSlugs(csvPath) {
    const rows = parseCsv(readFileSync(csvPath, "utf8"), csvPath);
    const header = rows.shift();
    const linkIndex = header.findIndex((field) => field.trim() === "Link");
    if (linkIndex === -1) {
        throw new Error(`Company CSV is missing a Link column: ${csvPath}`);
    }
    const slugs = [];
    const seen = new Set();
    for (let index = 0; index < rows.length; index += 1) {
        const link = rows[index][linkIndex]?.trim();
        if (!link && rows[index].every((field) => field.trim() === "")) {
            continue;
        }
        const match = /^https:\/\/leetcode\.com\/problems\/([^/?#]+)\/?(?:[?#].*)?$/.exec(link ?? "");
        if (!match) {
            throw new Error(`Invalid LeetCode problem link in ${csvPath} row ${index + 2}: ${link || "<missing>"}`);
        }
        let slug;
        try {
            slug = decodeURIComponent(match[1]);
        } catch (_error) {
            throw new Error(`Invalid encoded problem slug in ${csvPath} row ${index + 2}: ${match[1]}`);
        }
        if (!seen.has(slug)) {
            seen.add(slug);
            slugs.push(slug);
        }
    }
    return slugs;
}

function parseCsv(csv, csvPath) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < csv.length; index += 1) {
        const character = csv[index];
        if (quoted) {
            if (character === '"' && csv[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character === '"' && field.length === 0) {
            quoted = true;
        } else if (character === ",") {
            row.push(field);
            field = "";
        } else if (character === "\n") {
            row.push(field.replace(/\r$/, ""));
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += character;
        }
    }
    if (quoted) {
        throw new Error(`Unterminated quoted field in company CSV: ${csvPath}`);
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
    }
    if (rows.length === 0 || rows[0].length === 0) {
        throw new Error(`Company CSV is empty: ${csvPath}`);
    }
    rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
    return rows;
}

export function buildCompanyData(sourceDirectory, slugToQuestionId) {
    const companyTags = {};
    const missingSlugs = new Set();
    const companyNames = readdirSync(sourceDirectory)
        .filter((name) => !name.startsWith(".") && statSync(join(sourceDirectory, name)).isDirectory())
        .sort(compareNames);
    if (companyNames.length === 0) {
        throw new Error(`No company directories found in ${sourceDirectory}`);
    }
    for (const companyName of companyNames) {
        const companyDirectory = join(sourceDirectory, companyName);
        const details = {};
        for (const [filename, windowName] of WINDOWS) {
            const csvPath = join(companyDirectory, filename);
            let slugs;
            try {
                slugs = extractProblemSlugs(csvPath);
            } catch (error) {
                if (error.code === "ENOENT") {
                    throw new Error(`Missing company CSV: ${csvPath}`);
                }
                throw error;
            }
            const questionIds = [];
            for (const slug of slugs) {
                const questionId = slugToQuestionId.get(slug);
                if (!questionId) {
                    missingSlugs.add(slug);
                    continue;
                }
                questionIds.push(questionId);
            }
            details[windowName] = questionIds;
        }
        companyTags[companyName] = details;
    }
    if (missingSlugs.size > 0) {
        const sample = [...missingSlugs].sort(compareNames).slice(0, 20).join(", ");
        throw new Error(`Could not map ${missingSlugs.size} problem slug(s) to LeetCode IDs: ${sample}`);
    }

    const questionCompanies = new Map();
    for (const [companyName, details] of Object.entries(companyTags)) {
        const allQuestionIds = new Set(COMPANY_WINDOWS.flatMap((window) => details[window]));
        for (const questionId of allQuestionIds) {
            if (!questionCompanies.has(questionId)) { questionCompanies.set(questionId, []); }
            questionCompanies.get(questionId).push(companyName);
        }
    }
    const questionCompanyTags = {};
    for (const questionId of [...questionCompanies.keys()].sort(compareQuestionIds)) {
        questionCompanyTags[questionId] = questionCompanies.get(questionId).sort(compareNames);
    }
    return { companyTags, questionCompanyTags };
}

export async function synchronizeCompanyData(options = {}) {
    const liveRevision = resolveRemoteHead(SOURCE_GIT_URL, "main");
    if (options.expectedSourceRevision && options.expectedSourceRevision.toLowerCase() !== liveRevision) {
        throw new Error(`Requested company source revision ${options.expectedSourceRevision} is stale; live main is ${liveRevision}`);
    }
    let temporaryDirectory;
    let sourceDirectory = options.sourceDirectory;
    try {
        if (!sourceDirectory) {
            temporaryDirectory = mkdtempSync(join(tmpdir(), "vscode-leetnotion-company-data-"));
            sourceDirectory = join(temporaryDirectory, "source");
            checkoutExactRevision(SOURCE_GIT_URL, liveRevision, sourceDirectory);
        } else {
            try {
                const sourceRevision = runGit(["-C", sourceDirectory, "rev-parse", "HEAD"]);
                if (options.expectedSourceRevision && sourceRevision.toLowerCase() !== liveRevision) {
                    throw new Error(`Source directory is at ${sourceRevision}, live main is ${liveRevision}`);
                }
            } catch (error) {
                if (options.expectedSourceRevision) { throw error; }
            }
        }

        const slugToQuestionId = await loadSlugToQuestionId(options.problemsFile);
        const { companyTags, questionCompanyTags } = buildCompanyData(sourceDirectory, slugToQuestionId);
        const provenance = {
            schemaVersion: 1,
            sourceRepository: SOURCE_REPOSITORY,
            sourceRevision: liveRevision,
            generatedAt: new Date().toISOString(),
        };
        validateCompanyDataset(companyTags, questionCompanyTags, provenance);

        const outputDirectory = options.outputDirectory ?? join(repositoryRoot, "data");
        const outputPaths = {
            companyTags: join(outputDirectory, "companyTags.json"),
            questionCompanyTags: join(outputDirectory, "questionCompanyTags.json"),
            provenance: join(outputDirectory, "company-data-provenance.json"),
        };
        atomicWriteFiles([
            { path: outputPaths.companyTags, content: `${JSON.stringify(companyTags)}\n` },
            { path: outputPaths.questionCompanyTags, content: `${JSON.stringify(questionCompanyTags)}\n` },
            { path: outputPaths.provenance, content: `${JSON.stringify(provenance, null, 2)}\n` },
        ], {
            validate: (stagedPaths) => validateCompanyDataset(
                JSON.parse(readFileSync(stagedPaths.get(outputPaths.companyTags), "utf8")),
                JSON.parse(readFileSync(stagedPaths.get(outputPaths.questionCompanyTags), "utf8")),
                JSON.parse(readFileSync(stagedPaths.get(outputPaths.provenance), "utf8")),
            ),
        });
        return {
            companies: Object.keys(companyTags).length,
            questions: Object.keys(questionCompanyTags).length,
            revision: liveRevision,
        };
    } finally {
        if (temporaryDirectory) { rmSync(temporaryDirectory, { recursive: true, force: true }); }
    }
}

async function main() {
    const result = await synchronizeCompanyData(parseArguments(process.argv.slice(2)));
    console.log(`Updated ${result.companies} companies and ${result.questions} questions from ${result.revision}.`);
}

const invokedAsScript = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) { await main(); }
