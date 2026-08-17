import * as childProcess from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";

interface SiteProblem {
    code?: string;
    link?: string;
    problem?: string;
    pattern?: string;
    difficulty?: string;
    video?: string;
    neetcode150?: unknown;
    blind75?: unknown;
}

interface LeetCodeProblem {
    stat?: {
        frontend_question_id?: number | string;
        question__title?: string;
        question__title_slug?: string;
    };
    difficulty?: {
        level?: number;
    };
}

interface LeetCodePayload {
    stat_status_pairs?: LeetCodeProblem[];
}

interface ProblemIdentity {
    questionId: string;
    title: string;
    titleSlug: string;
    difficulty?: string;
}

interface ContentAssignment {
    slug: string;
    priority: number;
}

interface EnrichedProblem {
    questionId: string;
    title: string;
    titleSlug: string;
    code: string;
    pattern?: string;
    difficulty?: string;
    problemUrl?: string;
    solutionSlug?: string;
    solutionUrl?: string;
    videoUrl?: string;
    articleMarkdown?: string;
    hintMarkdown?: string;
    neetcode150: boolean;
    blind75: boolean;
}

interface Dataset {
    generatedAt: string;
    sourceRepo: string;
    problems: Record<string, EnrichedProblem>;
}

const SOURCE_REPO = "https://github.com/neetcode-gh/leetcode";
const SOURCE_GIT_URL = `${SOURCE_REPO}.git`;
const LEETCODE_PROBLEMS_URL = "https://leetcode.com/api/problems/all/";
const SOLUTION_DIRECTORIES = [
    "c",
    "cpp",
    "csharp",
    "dart",
    "go",
    "java",
    "javascript",
    "kotlin",
    "python",
    "ruby",
    "rust",
    "scala",
    "swift",
    "typescript",
];

const CONTENT_SLUG_TO_QUESTION_ID: Record<string, string> = {
    "anagram-groups": "49",
    "binary-tree-diameter": "543",
    "binary-tree-from-preorder-and-inorder-traversal": "105",
    "buy-and-sell-crypto": "121",
    "buy-and-sell-crypto-with-cooldown": "309",
    "cheapest-flight-path": "787",
    "combination-target-sum": "39",
    "combination-target-sum-ii": "40",
    "combinations-of-a-phone-number": "17",
    "copy-linked-list-with-random-pointer": "138",
    "count-connected-components": "323",
    "count-number-of-islands": "200",
    "count-paths": "62",
    "count-squares": "1277",
    "count-subsequences": "1498",
    "depth-of-binary-tree": "104",
    "design-twitter-feed": "355",
    "design-word-search-data-structure": "211",
    "duplicate-integer": "217",
    "eating-bananas": "875",
    "find-duplicate-integer": "287",
    "find-median-in-a-data-stream": "295",
    "find-target-in-rotated-sorted-array": "33",
    "foreign-dictionary": "269",
    "implement-prefix-tree": "208",
    "insert-new-interval": "57",
    "invert-a-binary-tree": "226",
    "is-anagram": "242",
    "is-palindrome": "125",
    "islands-and-treasure": "286",
    "kth-largest-integer-in-a-stream": "703",
    "kth-smallest-integer-in-bst": "230",
    "level-order-traversal-of-binary-tree": "102",
    "linked-list-cycle-detection": "141",
    "longest-repeating-substring-with-replacement": "424",
    "longest-increasing-path-in-matrix": "329",
    "longest-substring-without-duplicates": "3",
    "lowest-common-ancestor-in-binary-search-tree": "235",
    "max-water-container": "11",
    "meeting-schedule": "252",
    "meeting-schedule-ii": "253",
    "merge-k-sorted-linked-lists": "23",
    "merge-triplets-to-form-target": "1899",
    "merge-two-sorted-linked-lists": "21",
    "min-cost-to-connect-points": "1584",
    "minimum-interval-including-query": "1851",
    "minimum-stack": "155",
    "minimum-window-with-characters": "76",
    "non-cyclical-number": "202",
    "number-of-one-bits": "191",
    "products-of-array-discluding-self": "238",
    "permutation-string": "567",
    "reconstruct-flight-path": "332",
    "remove-node-from-end-of-linked-list": "19",
    "reorder-linked-list": "143",
    "reverse-a-linked-list": "206",
    "rotate-matrix": "48",
    "rotting-fruit": "994",
    "same-binary-tree": "100",
    "search-2d-matrix": "74",
    "search-for-word": "79",
    "search-for-word-ii": "212",
    "set-zeroes-in-matrix": "73",
    "string-encode-and-decode": "271",
    "subtree-of-a-binary-tree": "572",
    "task-scheduling": "621",
    "three-integer-sum": "15",
    "top-k-elements-in-list": "347",
    "two-integer-sum": "1",
    "two-integer-sum-ii": "167",
    "valid-binary-search-tree": "98",
    "valid-tree": "261",
    "validate-parentheses": "20",
};
const extensionRoot = process.cwd();
const outputPath = path.join(extensionRoot, "data", "neetcode-enrichment.json");

void main();

async function main(): Promise<void> {
    const sourceArgument = process.argv[2];
    const problemsFile = process.argv[3] ? path.resolve(extensionRoot, process.argv[3]) : undefined;
    let temporaryDirectory: string | undefined;
    let sourceRoot: string;

    try {
        if (sourceArgument) {
            sourceRoot = path.resolve(extensionRoot, sourceArgument);
        } else {
            temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-leetnotion-neetcode-"));
            sourceRoot = path.join(temporaryDirectory, "source");
            childProcess.execFileSync("git", ["clone", "--depth", "1", SOURCE_GIT_URL, sourceRoot], { stdio: "inherit" });
        }

        const siteDataPath = path.join(sourceRoot, ".problemSiteData.json");
        const articlesPath = path.join(sourceRoot, "articles");
        const hintsPath = path.join(sourceRoot, "hints");
        assertExists(siteDataPath, "NeetCode .problemSiteData.json");
        assertExists(articlesPath, "NeetCode articles directory");
        assertExists(hintsPath, "NeetCode hints directory");

        const siteData = readSiteData(siteDataPath);
        const articleFiles = new Set(readMarkdownBasenames(articlesPath));
        const hintFiles = new Set(readMarkdownBasenames(hintsPath));
        const identities = await loadLeetCodeIdentities(problemsFile);
        const solutionSlugToId = readSolutionSlugToId(sourceRoot);
        const siteProblemById = new Map<string, SiteProblem>();
        for (const problem of siteData) {
            const questionId = resolveSiteQuestionId(problem, identities.bySlug);
            if (questionId) {
                siteProblemById.set(questionId, problem);
            }
        }

        const articleAssignments = resolveContentAssignments(
            articleFiles,
            siteData,
            identities.bySlug,
            solutionSlugToId,
        );
        const articleIdBySlug = invertAssignments(articleAssignments);
        const hintAssignments = resolveContentAssignments(
            hintFiles,
            siteData,
            identities.bySlug,
            solutionSlugToId,
            articleIdBySlug,
        );

        const dataset: Dataset = {
            generatedAt: new Date().toISOString(),
            sourceRepo: getSourceReference(sourceRoot),
            problems: {},
        };
        const allQuestionIds = new Set<string>([
            ...siteProblemById.keys(),
            ...articleAssignments.keys(),
            ...hintAssignments.keys(),
        ]);

        for (const questionId of [...allQuestionIds].sort(compareQuestionIds)) {
            const siteProblem = siteProblemById.get(questionId);
            const identity = identities.byId.get(questionId);
            const articleSlug = articleAssignments.get(questionId)?.slug;
            const hintSlug = hintAssignments.get(questionId)?.slug;
            const solutionSlug = articleSlug || hintSlug || trimSlashes(siteProblem?.link) || codeSlug(siteProblem?.code);
            const titleSlug = trimSlashes(siteProblem?.link) || identity?.titleSlug || solutionSlug;
            const title = siteProblem?.problem || identity?.title || titleFromSlug(titleSlug);
            const neetcode150 = Boolean(siteProblem?.neetcode150);
            const blind75 = Boolean(siteProblem?.blind75);

            dataset.problems[questionId] = {
                questionId,
                title,
                titleSlug,
                code: siteProblem?.code && extractQuestionId(siteProblem.code) === questionId
                    ? siteProblem.code
                    : `${questionId.padStart(4, "0")}-${titleSlug}`,
                pattern: siteProblem?.pattern || undefined,
                difficulty: siteProblem?.difficulty || identity?.difficulty,
                problemUrl: solutionSlug ? `https://neetcode.io/problems/${solutionSlug}` : undefined,
                solutionSlug,
                solutionUrl: buildSolutionUrl(solutionSlug, neetcode150, blind75),
                videoUrl: siteProblem?.video ? `https://www.youtube.com/watch?v=${siteProblem.video}` : undefined,
                articleMarkdown: articleSlug ? readMarkdown(path.join(articlesPath, `${articleSlug}.md`)) : undefined,
                hintMarkdown: hintSlug ? readMarkdown(path.join(hintsPath, `${hintSlug}.md`)) : undefined,
                neetcode150,
                blind75,
            };
        }

        fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
        reportCoverage(dataset, siteProblemById, articleFiles, hintFiles, articleAssignments, hintAssignments);
    } finally {
        if (temporaryDirectory) {
            fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        }
    }
}

function assertExists(targetPath: string, description: string): void {
    if (!fs.existsSync(targetPath)) {
        throw new Error(`${description} not found at ${targetPath}`);
    }
}

function readSiteData(filePath: string): SiteProblem[] {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(raw)) {
        throw new Error(`Unexpected site data format in ${filePath}`);
    }
    return raw as SiteProblem[];
}

function readMarkdownBasenames(directoryPath: string): string[] {
    return fs
        .readdirSync(directoryPath)
        .filter((fileName) => fileName.endsWith(".md"))
        .map((fileName) => fileName.slice(0, -3))
        .sort();
}

async function loadLeetCodeIdentities(problemsFile?: string): Promise<{
    byId: Map<string, ProblemIdentity>;
    bySlug: Map<string, ProblemIdentity>;
}> {
    const body = problemsFile
        ? fs.readFileSync(problemsFile, "utf8")
        : await downloadText(LEETCODE_PROBLEMS_URL);
    const payload = JSON.parse(body) as LeetCodePayload;
    const byId = new Map<string, ProblemIdentity>();
    const bySlug = new Map<string, ProblemIdentity>();

    for (const item of payload.stat_status_pairs || []) {
        const questionId = item.stat?.frontend_question_id;
        const title = item.stat?.question__title;
        const titleSlug = item.stat?.question__title_slug;
        if (questionId === undefined || questionId === null || !title || !titleSlug) {
            continue;
        }
        const identity: ProblemIdentity = {
            questionId: String(questionId),
            title,
            titleSlug,
            difficulty: difficultyName(item.difficulty?.level),
        };
        byId.set(identity.questionId, identity);
        bySlug.set(identity.titleSlug, identity);
    }

    if (byId.size === 0) {
        throw new Error("LeetCode problem data did not contain any usable problem identities");
    }
    return { byId, bySlug };
}

function downloadText(url: string, redirectsRemaining = 5): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: { "User-Agent": "vscode-leetnotion-neetcode-sync" },
        }, (response) => {
            const location = response.headers.location;
            if (location && response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
                response.resume();
                if (redirectsRemaining === 0) {
                    reject(new Error(`Too many redirects while downloading ${url}`));
                    return;
                }
                resolve(downloadText(new URL(location, url).toString(), redirectsRemaining - 1));
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
            response.on("end", () => resolve(body));
        });
        request.on("error", reject);
    });
}

function readSolutionSlugToId(sourceRoot: string): Map<string, string> {
    const idsBySlug = new Map<string, Set<string>>();
    for (const directoryName of SOLUTION_DIRECTORIES) {
        const directoryPath = path.join(sourceRoot, directoryName);
        if (!fs.existsSync(directoryPath)) {
            continue;
        }
        for (const fileName of fs.readdirSync(directoryPath)) {
            const match = /^(\d+)-(.+)\.[^.]+$/.exec(fileName);
            if (!match) {
                continue;
            }
            const questionId = String(Number.parseInt(match[1], 10));
            const slug = match[2].toLowerCase();
            if (!idsBySlug.has(slug)) {
                idsBySlug.set(slug, new Set());
            }
            idsBySlug.get(slug)?.add(questionId);
        }
    }

    const uniqueSlugToId = new Map<string, string>();
    for (const [slug, ids] of idsBySlug) {
        if (ids.size === 1) {
            uniqueSlugToId.set(slug, [...ids][0]);
        }
    }
    return uniqueSlugToId;
}

function resolveContentAssignments(
    knownFiles: Set<string>,
    siteData: SiteProblem[],
    identityBySlug: Map<string, ProblemIdentity>,
    solutionSlugToId: Map<string, string>,
    preferredIdBySlug?: Map<string, string>,
): Map<string, ContentAssignment> {
    const assignments = new Map<string, ContentAssignment>();
    const assignedSlugs = new Set<string>();

    const assign = (questionId: string, slug: string, priority: number): void => {
        if (!knownFiles.has(slug) || assignedSlugs.has(slug)) {
            return;
        }
        const existing = assignments.get(questionId);
        if (existing && existing.priority >= priority) {
            return;
        }
        if (existing) {
            assignedSlugs.delete(existing.slug);
        }
        assignments.set(questionId, { slug, priority });
        assignedSlugs.add(slug);
    };

    for (const slug of knownFiles) {
        const aliasedQuestionId = CONTENT_SLUG_TO_QUESTION_ID[slug];
        const preferredId = preferredIdBySlug?.get(slug);
        const identity = identityBySlug.get(slug);
        const solutionId = solutionSlugToId.get(slug.toLowerCase());
        if (preferredId) {
            assign(preferredId, slug, 5);
        } else if (identity) {
            assign(identity.questionId, slug, 4);
        } else if (solutionId) {
            assign(solutionId, slug, 3);
        } else if (aliasedQuestionId) {
            assign(aliasedQuestionId, slug, 2);
        }
    }

    for (const problem of siteData) {
        const questionId = resolveSiteQuestionId(problem, identityBySlug);
        if (!questionId || assignments.has(questionId)) {
            continue;
        }
        const candidates = unique([
            codeSlug(problem.code),
            trimSlashes(problem.link),
            slugify(problem.problem),
        ].filter(Boolean));
        const exactSlug = candidates.find((candidate) => knownFiles.has(candidate) && !assignedSlugs.has(candidate));
        if (exactSlug) {
            assign(questionId, exactSlug, 2);
        }
    }

    return assignments;
}

function invertAssignments(assignments: Map<string, ContentAssignment>): Map<string, string> {
    const idBySlug = new Map<string, string>();
    for (const [questionId, assignment] of assignments) {
        idBySlug.set(assignment.slug, questionId);
    }
    return idBySlug;
}

function extractQuestionId(problemCode?: string): string | undefined {
    if (!problemCode || typeof problemCode !== "string") {
        return undefined;
    }
    const parsed = Number.parseInt(problemCode.split("-")[0], 10);
    return Number.isNaN(parsed) ? undefined : String(parsed);
}

function resolveSiteQuestionId(
    problem: SiteProblem,
    identityBySlug: Map<string, ProblemIdentity>,
): string | undefined {
    const titleSlug = trimSlashes(problem.link);
    return identityBySlug.get(titleSlug)?.questionId || extractQuestionId(problem.code);
}

function codeSlug(problemCode?: string): string {
    return problemCode?.split("-").slice(1).join("-") || "";
}

function trimSlashes(value?: string): string {
    return (value || "").replace(/^\/+|\/+$/g, "");
}

function slugify(value?: string): string {
    return (value || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[’']/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function titleFromSlug(slug: string): string {
    return slug
        .split("-")
        .filter(Boolean)
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
        .join(" ");
}

function readMarkdown(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
}

function buildSolutionUrl(solutionSlug: string | undefined, neetcode150: boolean, blind75: boolean): string | undefined {
    if (!solutionSlug) {
        return undefined;
    }
    const list = neetcode150 ? "neetcode150" : blind75 ? "blind75" : undefined;
    return list
        ? `https://neetcode.io/problems/${solutionSlug}/question?list=${list}`
        : `https://neetcode.io/problems/${solutionSlug}/question/solution`;
}

function difficultyName(level?: number): string | undefined {
    return level === 1 ? "Easy" : level === 2 ? "Medium" : level === 3 ? "Hard" : undefined;
}

function getSourceReference(sourceRoot: string): string {
    try {
        const revision = childProcess.execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        return `${SOURCE_REPO}/tree/${revision}`;
    } catch (_error) {
        return path.relative(extensionRoot, sourceRoot) || ".";
    }
}

function reportCoverage(
    dataset: Dataset,
    siteProblemById: Map<string, SiteProblem>,
    articleFiles: Set<string>,
    hintFiles: Set<string>,
    articleAssignments: Map<string, ContentAssignment>,
    hintAssignments: Map<string, ContentAssignment>,
): void {
    const curatedMissingArticles = [...siteProblemById.keys()].filter((questionId) => !articleAssignments.has(questionId));
    const curatedMissingHints = [...siteProblemById.keys()].filter((questionId) => !hintAssignments.has(questionId));
    const assignedArticleSlugs = new Set([...articleAssignments.values()].map((assignment) => assignment.slug));
    const assignedHintSlugs = new Set([...hintAssignments.values()].map((assignment) => assignment.slug));
    const unassignedArticles = [...articleFiles].filter((slug) => !assignedArticleSlugs.has(slug));
    const unassignedHints = [...hintFiles].filter((slug) => !assignedHintSlugs.has(slug));
    const videoCount = Object.values(dataset.problems).filter((problem) => Boolean(problem.videoUrl)).length;

    console.log(`Wrote ${Object.keys(dataset.problems).length} NeetCode entries to ${path.relative(extensionRoot, outputPath)}`);
    console.log(`Curated index: ${siteProblemById.size}; videos: ${videoCount}`);
    console.log(`Articles: ${articleAssignments.size}/${articleFiles.size}; unassigned: ${unassignedArticles.length}`);
    console.log(`Hints: ${hintAssignments.size}/${hintFiles.size}; unassigned: ${unassignedHints.length}`);
    console.log(`Curated entries without articles: ${curatedMissingArticles.length}; without hints: ${curatedMissingHints.length}`);
    if (unassignedArticles.length > 0) {
        console.log(`Unassigned article sample: ${unassignedArticles.slice(0, 20).join(", ")}`);
    }
    if (unassignedHints.length > 0) {
        console.log(`Unassigned hint sample: ${unassignedHints.slice(0, 20).join(", ")}`);
    }
}

function compareQuestionIds(left: string, right: string): number {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
}

function unique<T>(values: T[]): T[] {
    return Array.from(new Set(values));
}
