import * as fs from "fs";
import * as path from "path";

type ContentKind = "article" | "hint";

interface ContentAlias {
    article?: string;
    hint?: string;
}

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

interface MarkdownMatch {
    slug: string | undefined;
    fromAlias: boolean;
}

interface FallbackCandidate {
    slug: string;
    distance: number;
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

const CONTENT_ALIASES: Record<string, ContentAlias> = {
    "1": {
        article: "two-integer-sum",
        hint: "two-integer-sum",
    },
};

const SLUG_STOP_WORDS = new Set(["a", "an", "and", "for", "from", "in", "of", "the", "to"]);

const extensionRoot = process.cwd();
const sourceRoot = path.resolve(extensionRoot, process.argv[2] || "../leetcode");
const outputPath = path.join(extensionRoot, "data", "neetcode-enrichment.json");

const siteDataPath = path.join(sourceRoot, ".problemSiteData.json");
const articlesPath = path.join(sourceRoot, "articles");
const hintsPath = path.join(sourceRoot, "hints");

assertExists(siteDataPath, "NeetCode .problemSiteData.json");
assertExists(articlesPath, "NeetCode articles directory");
assertExists(hintsPath, "NeetCode hints directory");

const siteData = readSiteData(siteDataPath);
const articleFiles = new Set(readMarkdownBasenames(articlesPath));
const hintFiles = new Set(readMarkdownBasenames(hintsPath));

const dataset: Dataset = {
    generatedAt: new Date().toISOString(),
    sourceRepo: path.relative(extensionRoot, sourceRoot) || ".",
    problems: {},
};

const stats = {
    total: 0,
    withArticle: 0,
    withHint: 0,
    withVideo: 0,
    articleAliases: 0,
    hintAliases: 0,
};

const missingArticleIds: string[] = [];
const missingHintIds: string[] = [];

for (const problem of siteData) {
    const questionId = extractQuestionId(problem.code);
    if (!questionId) {
        continue;
    }

    stats.total += 1;

    const articleMatch = resolveMarkdownMatch(problem, questionId, articleFiles, "article");
    const hintMatch = resolveMarkdownMatch(problem, questionId, hintFiles, "hint");
    const titleSlug = trimSlashes(problem.link) || slugify(problem.problem) || codeSlug(problem.code);

    if (articleMatch.fromAlias) {
        stats.articleAliases += 1;
    }
    if (hintMatch.fromAlias) {
        stats.hintAliases += 1;
    }

    const articleMarkdown = articleMatch.slug ? readMarkdown(path.join(articlesPath, `${articleMatch.slug}.md`)) : undefined;
    const hintMarkdown = hintMatch.slug ? readMarkdown(path.join(hintsPath, `${hintMatch.slug}.md`)) : undefined;
    const solutionSlug = articleMatch.slug || hintMatch.slug || titleSlug;
    const videoUrl = problem.video ? `https://www.youtube.com/watch?v=${problem.video}` : undefined;

    if (articleMarkdown) {
        stats.withArticle += 1;
    } else {
        missingArticleIds.push(questionId);
    }

    if (hintMarkdown) {
        stats.withHint += 1;
    } else {
        missingHintIds.push(questionId);
    }

    if (videoUrl) {
        stats.withVideo += 1;
    }

    dataset.problems[questionId] = {
        questionId,
        title: problem.problem || "",
        titleSlug,
        code: problem.code || "",
        pattern: problem.pattern || undefined,
        difficulty: problem.difficulty || undefined,
        problemUrl: titleSlug ? `https://neetcode.io/problems/${titleSlug}` : undefined,
        solutionSlug,
        solutionUrl: buildSolutionUrl(solutionSlug, Boolean(problem.neetcode150), Boolean(problem.blind75)),
        videoUrl,
        articleMarkdown,
        hintMarkdown,
        neetcode150: Boolean(problem.neetcode150),
        blind75: Boolean(problem.blind75),
    };
}

fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

console.log(`Wrote ${Object.keys(dataset.problems).length} NeetCode entries to ${path.relative(extensionRoot, outputPath)}`);
console.log(`Articles: ${stats.withArticle}/${stats.total} (${stats.articleAliases} aliases)`);
console.log(`Hints: ${stats.withHint}/${stats.total} (${stats.hintAliases} aliases)`);
console.log(`Videos: ${stats.withVideo}/${stats.total}`);

if (missingArticleIds.length > 0) {
    console.log(`Missing articles for ${missingArticleIds.length} questions. Sample IDs: ${missingArticleIds.slice(0, 20).join(", ")}`);
}

if (missingHintIds.length > 0) {
    console.log(`Missing hints for ${missingHintIds.length} questions. Sample IDs: ${missingHintIds.slice(0, 20).join(", ")}`);
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
        .map((fileName) => fileName.slice(0, -3));
}

function resolveMarkdownMatch(problem: SiteProblem, questionId: string, knownFiles: Set<string>, kind: ContentKind): MarkdownMatch {
    const aliasSlug = CONTENT_ALIASES[questionId]?.[kind];
    if (aliasSlug && knownFiles.has(aliasSlug)) {
        return { slug: aliasSlug, fromAlias: true };
    }

    const candidates = [codeSlug(problem.code), trimSlashes(problem.link), slugify(problem.problem)].filter(Boolean);

    for (const candidate of unique(candidates)) {
        if (knownFiles.has(candidate)) {
            return { slug: candidate, fromAlias: false };
        }
    }

    const fallbackSlug = resolveFallbackMarkdownSlug(candidates, knownFiles);
    if (fallbackSlug) {
        return { slug: fallbackSlug, fromAlias: false };
    }

    return { slug: undefined, fromAlias: false };
}

function resolveFallbackMarkdownSlug(candidates: string[], knownFiles: Set<string>): string | undefined {
    const matches: FallbackCandidate[] = [];

    for (const knownFile of knownFiles) {
        const distances = candidates
            .map((candidate) => getFallbackSlugDistance(candidate, knownFile))
            .filter((distance): distance is number => distance !== undefined);

        if (distances.length === 0) {
            continue;
        }

        matches.push({
            slug: knownFile,
            distance: Math.min(...distances),
        });
    }

    if (matches.length === 0) {
        return undefined;
    }

    matches.sort((left, right) => left.distance - right.distance || left.slug.localeCompare(right.slug));
    if (matches.length > 1 && matches[0].distance === matches[1].distance) {
        return undefined;
    }

    return matches[0].slug;
}

function getFallbackSlugDistance(left: string, right: string): number | undefined {
    const leftTokens = tokenizeSlug(left);
    const rightTokens = tokenizeSlug(right);
    if (leftTokens.length === 0 || rightTokens.length === 0) {
        return undefined;
    }

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const sharedCount = leftTokens.filter((token) => rightSet.has(token)).length;
    if (sharedCount < 2) {
        return undefined;
    }

    const leftContainsRight = rightTokens.every((token) => leftSet.has(token));
    const rightContainsLeft = leftTokens.every((token) => rightSet.has(token));
    if (!leftContainsRight && !rightContainsLeft) {
        return undefined;
    }

    return Math.abs(leftTokens.length - rightTokens.length);
}

function tokenizeSlug(value: string): string[] {
    return value
        .split("-")
        .map((token) => token.trim())
        .filter((token) => token.length > 0 && !SLUG_STOP_WORDS.has(token));
}

function extractQuestionId(problemCode?: string): string | undefined {
    if (!problemCode || typeof problemCode !== "string") {
        return undefined;
    }

    const prefix = problemCode.split("-")[0];
    const parsed = Number.parseInt(prefix, 10);
    return Number.isNaN(parsed) ? undefined : String(parsed);
}

function codeSlug(problemCode?: string): string {
    if (!problemCode || typeof problemCode !== "string") {
        return "";
    }

    return problemCode.split("-").slice(1).join("-");
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

function readMarkdown(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
}

function buildSolutionUrl(solutionSlug: string | undefined, neetcode150: boolean, blind75: boolean): string | undefined {
    if (!solutionSlug) {
        return undefined;
    }

    const list = neetcode150 ? "neetcode150" : blind75 ? "blind75" : undefined;
    if (!list) {
        return `https://neetcode.io/problems/${solutionSlug}/question/solution`;
    }

    return `https://neetcode.io/problems/${solutionSlug}/question?list=${list}`;
}

function unique<T>(values: T[]): T[] {
    return Array.from(new Set(values));
}
