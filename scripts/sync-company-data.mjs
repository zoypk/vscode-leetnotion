import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_REPO = "https://github.com/liquidslr/leetcode-company-wise-problems.git";
const LEETCODE_PROBLEMS_URL = "https://leetcode.com/api/problems/all/";
const WINDOWS = new Map([
    ["1. Thirty Days.csv", "Last 30 Days"],
    ["2. Three Months.csv", "Last 3 Months"],
    ["3. Six Months.csv", "Last 6 Months"],
    ["4. More Than Six Months.csv", "More Than 6 Months"],
    ["5. All.csv", "All Time"],
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

function parseArguments(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--source-dir") {
            options.sourceDirectory = resolve(argv[++index]);
        } else if (argument === "--problems-file") {
            options.problemsFile = resolve(argv[++index]);
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    return options;
}

function downloadText(url, redirectsRemaining = 5) {
    return new Promise((resolvePromise, reject) => {
        const request = httpsGet(url, {
            headers: { "User-Agent": "vscode-leetnotion-company-data-sync" },
        }, (response) => {
            const location = response.headers.location;
            if (location && response.statusCode >= 300 && response.statusCode < 400) {
                response.resume();
                if (redirectsRemaining === 0) {
                    reject(new Error(`Too many redirects while downloading ${url}`));
                    return;
                }
                resolvePromise(downloadText(new URL(location, url).toString(), redirectsRemaining - 1));
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
                return;
            }

            response.setEncoding("utf8");
            let body = "";
            response.on("data", (chunk) => { body += chunk; });
            response.on("end", () => resolvePromise(body));
        });
        request.on("error", reject);
    });
}

function loadSlugToQuestionId(problemsFile) {
    return (problemsFile
        ? Promise.resolve(readFileSync(problemsFile, "utf8"))
        : downloadText(LEETCODE_PROBLEMS_URL)
    ).then((body) => {
        const payload = JSON.parse(body);
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
    });
}

function extractProblemSlugs(csvPath) {
    const csv = readFileSync(csvPath, "utf8");
    const slugs = [];
    const seen = new Set();
    const linkPattern = /https:\/\/leetcode\.com\/problems\/([^/\s?#",]+)/g;
    for (const match of csv.matchAll(linkPattern)) {
        const slug = decodeURIComponent(match[1]);
        if (!seen.has(slug)) {
            seen.add(slug);
            slugs.push(slug);
        }
    }
    return slugs;
}

function compareNames(left, right) {
    return left.localeCompare(right, "en", { sensitivity: "variant" });
}

function compareQuestionIds(left, right) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
    }
    return compareNames(left, right);
}

function buildCompanyData(sourceDirectory, slugToQuestionId) {
    const companyTags = {};
    const missingSlugs = new Set();
    const companyNames = readdirSync(sourceDirectory)
        .filter((name) => !name.startsWith(".") && statSync(join(sourceDirectory, name)).isDirectory())
        .sort(compareNames);

    for (const companyName of companyNames) {
        const companyDirectory = join(sourceDirectory, companyName);
        const details = {};
        for (const [filename, windowName] of WINDOWS) {
            const csvPath = join(companyDirectory, filename);
            const questionIds = [];
            for (const slug of extractProblemSlugs(csvPath)) {
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
        for (const questionId of details["All Time"]) {
            if (!questionCompanies.has(questionId)) {
                questionCompanies.set(questionId, []);
            }
            questionCompanies.get(questionId).push(companyName);
        }
    }

    const questionCompanyTags = {};
    for (const questionId of [...questionCompanies.keys()].sort(compareQuestionIds)) {
        questionCompanyTags[questionId] = questionCompanies.get(questionId).sort(compareNames);
    }
    return { companyTags, questionCompanyTags };
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    let temporaryDirectory;
    let sourceDirectory = options.sourceDirectory;

    try {
        if (!sourceDirectory) {
            temporaryDirectory = mkdtempSync(join(tmpdir(), "vscode-leetnotion-company-data-"));
            sourceDirectory = join(temporaryDirectory, "source");
            execFileSync("git", ["clone", "--depth", "1", SOURCE_REPO, sourceDirectory], { stdio: "inherit" });
        }

        const slugToQuestionId = await loadSlugToQuestionId(options.problemsFile);
        const { companyTags, questionCompanyTags } = buildCompanyData(sourceDirectory, slugToQuestionId);
        writeFileSync(join(repositoryRoot, "data", "companyTags.json"), `${JSON.stringify(companyTags)}\n`);
        writeFileSync(join(repositoryRoot, "data", "questionCompanyTags.json"), `${JSON.stringify(questionCompanyTags)}\n`);

        console.log(`Updated ${Object.keys(companyTags).length} companies and ${Object.keys(questionCompanyTags).length} questions.`);
    } finally {
        if (temporaryDirectory) {
            rmSync(temporaryDirectory, { recursive: true, force: true });
        }
    }
}

await main();
