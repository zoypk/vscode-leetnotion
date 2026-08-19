import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDirectory, "..");
const outputPath = path.join(extensionRoot, "data", "jit-learning-resources.json");
const neetCodeDatasetPath = path.join(extensionRoot, "data", "neetcode-enrichment.json");

function normalizeMarkdown(markdown) {
    return markdown
        .replace(/<br\s*\/?>/gi, "\n\n")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
}

function validateResourceLinks(titleSlug, markdown) {
    for (const linkMatch of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        if (!linkMatch[1].startsWith("https://")) {
            throw new Error(`Unsupported resource URL for ${titleSlug}: ${linkMatch[1]}`);
        }
    }
}

function parseCueLadder(rawCueLadder) {
    const cueLadder = normalizeMarkdown(rawCueLadder);
    const revisedCueMatch = cueLadder.match(
        /^\*\*Before attempting:\*\*\s*([\s\S]*?)\n{2,}\*\*Reveal after an honest attempt:\*\*\s*([\s\S]+)$/
    );

    if (!revisedCueMatch) {
        return undefined;
    }

    return {
        beforeAttemptingMarkdown: revisedCueMatch[1].trim(),
        revealAfterAttemptMarkdown: revisedCueMatch[2].trim(),
    };
}

function parseProblemRow(line, currentSection) {
    const artifactRowMatch = line.match(
        /^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\(https:\/\/leetcode\.com\/problems\/([^/]+)\/\)(?:.*?)\|\s*(Easy|Medium|Hard)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/
    );
    if (artifactRowMatch) {
        const [, sourceIndex, title, titleSlug, difficulty, recognitionCue, artifacts, returnCheckpoint] = artifactRowMatch;
        const cueLadder = parseCueLadder(recognitionCue);
        const artifactPathMarkdown = normalizeMarkdown(artifacts);
        const returnWhenMarkdown = normalizeMarkdown(returnCheckpoint);

        if (cueLadder) {
            const { beforeAttemptingMarkdown, revealAfterAttemptMarkdown } = cueLadder;
            return {
                sourceIndex: Number(sourceIndex),
                title,
                titleSlug,
                section: currentSection,
                difficulty,
                beforeAttemptingMarkdown,
                revealAfterAttemptMarkdown,
                artifactPathMarkdown,
                returnWhenMarkdown,
                markdown: normalizeMarkdown([
                    `**Before attempting:** ${beforeAttemptingMarkdown}`,
                    "",
                    `**Reveal after an honest attempt:** ${revealAfterAttemptMarkdown}`,
                    "",
                    artifactPathMarkdown,
                    "",
                    `**Return when:** ${returnWhenMarkdown}`,
                ].join("\n")),
            };
        }

        return {
            sourceIndex: Number(sourceIndex),
            title,
            titleSlug,
            section: currentSection,
            difficulty,
            markdown: normalizeMarkdown([
                `**Cue:** ${recognitionCue}`,
                "",
                artifactPathMarkdown,
                "",
                `**Return:** ${returnWhenMarkdown}`,
            ].join("\n")),
        };
    }

    const legacyRowMatch = line.match(
        /^\|\s*(\d+)\s*\|\s*[^|]*\|\s*\[([^\]]+)\]\(https:\/\/leetcode\.com\/problems\/([^/]+)\/\)(?:.*?)\|\s*(Easy|Medium|Hard)\s*\|\s*(.*?)\s*\|\s*$/
    );
    if (legacyRowMatch) {
        const [, sourceIndex, title, titleSlug, difficulty, rawMarkdown] = legacyRowMatch;
        return {
            sourceIndex: Number(sourceIndex),
            title,
            titleSlug,
            section: currentSection,
            difficulty,
            markdown: normalizeMarkdown(rawMarkdown),
        };
    }

    return undefined;
}

function getExpectedProblemCount(sourceLines) {
    const coverageLine = sourceLines.find((line) => line.includes("**Coverage:**"));
    const coverageMatch = coverageLine?.match(/\*\*Coverage:\*\*[^0-9]*(?:\*\*)?(\d+)/);
    if (!coverageMatch) {
        throw new Error("Unable to read the advertised problem count from the Coverage line");
    }
    return Number(coverageMatch[1]);
}

export function parseResourceDocument(sourceText, knownTitleSlugs) {
    const sourceLines = sourceText.split(/\r?\n/);
    const expectedProblemCount = getExpectedProblemCount(sourceLines);
    const problems = {};
    let currentSection = "";
    let parsedProblemCount = 0;

    for (const line of sourceLines) {
        const sectionMatch = line.match(/^#\s+\d+\.\s+(.+?)\s*$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1];
            continue;
        }

        if (!/^\|\s*\d+\s*\|/.test(line)) {
            continue;
        }

        const problem = parseProblemRow(line, currentSection);
        if (!problem) {
            throw new Error(`Unable to parse problem resource row: ${line}`);
        }
        if (!currentSection) {
            throw new Error(`Problem row ${problem.sourceIndex} appears before a section heading`);
        }
        if (problems[problem.titleSlug]) {
            throw new Error(`Duplicate learning-resource slug: ${problem.titleSlug}`);
        }
        if (!knownTitleSlugs.has(problem.titleSlug)) {
            throw new Error(`Learning-resource slug is missing from NeetCode data: ${problem.titleSlug}`);
        }

        validateResourceLinks(problem.titleSlug, problem.markdown);
        problems[problem.titleSlug] = problem;
        parsedProblemCount += 1;
    }

    if (parsedProblemCount !== expectedProblemCount) {
        throw new Error(`Expected ${expectedProblemCount} problem resources, parsed ${parsedProblemCount}`);
    }

    return {
        problemCount: parsedProblemCount,
        problems,
    };
}

function importResourceDocument(sourcePath) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error("Usage: node scripts/import-jit-learning-resources.mjs <resource-list.md>");
    }

    const sourceText = fs.readFileSync(sourcePath, "utf8");
    const neetCodeDataset = JSON.parse(fs.readFileSync(neetCodeDatasetPath, "utf8"));
    const knownTitleSlugs = new Set(Object.values(neetCodeDataset.problems).map((problem) => problem.titleSlug));
    const parsed = parseResourceDocument(sourceText, knownTitleSlugs);
    const output = {
        source: path.basename(sourcePath),
        ...parsed,
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(`Wrote ${parsed.problemCount} learning-resource entries to ${path.relative(extensionRoot, outputPath)}`);
}

const invokedAsScript = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
    importResourceDocument(process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : undefined);
}
