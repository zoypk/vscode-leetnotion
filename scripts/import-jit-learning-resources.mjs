import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateJitLearningDataset } from "./lib/neetcode-validation.mjs";
import { atomicWriteFiles } from "./lib/sync-utils.mjs";

const EXPECTED_PROBLEM_COUNT = 150;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDirectory, "..");
const sourcePath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : undefined;
const outputPath = path.join(extensionRoot, "data", "jit-learning-resources.json");
const neetCodeDatasetPath = path.join(extensionRoot, "data", "neetcode-index.json");

export function parseLearningResources(sourceBytes, knownTitleSlugs, sourceName) {
    const sourceLines = sourceBytes.toString("utf8").split(/\r?\n/);
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

        const rowMatch = line.match(
            /^\|\s*(\d+)\s*\|\s*[^|]*\|\s*\[([^\]]+)\]\(https:\/\/leetcode\.com\/problems\/([^/]+)\/\)(?:.*?)\|\s*(Easy|Medium|Hard)\s*\|\s*(.*?)\s*\|\s*$/
        );
        if (!rowMatch) {
            throw new Error(`Unable to parse problem resource row: ${line}`);
        }
        if (!currentSection) {
            throw new Error(`Problem row ${rowMatch[1]} appears before a section heading`);
        }

        const [, sourceIndex, title, titleSlug, difficulty, rawMarkdown] = rowMatch;
        if (problems[titleSlug]) {
            throw new Error(`Duplicate learning-resource slug: ${titleSlug}`);
        }
        if (!knownTitleSlugs.has(titleSlug)) {
            throw new Error(`Learning-resource slug is missing from NeetCode data: ${titleSlug}`);
        }

        const markdown = rawMarkdown
            .replace(/<br\s*\/?>/gi, "\n\n")
            .replace(/[ \t]+\n/g, "\n")
            .trim();

        for (const linkMatch of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
            if (!linkMatch[1].startsWith("https://")) {
                throw new Error(`Unsupported resource URL for ${titleSlug}: ${linkMatch[1]}`);
            }
        }

        problems[titleSlug] = {
            sourceIndex: Number(sourceIndex),
            title,
            titleSlug,
            section: currentSection,
            difficulty,
            markdown,
        };
        parsedProblemCount += 1;
    }

    if (parsedProblemCount !== EXPECTED_PROBLEM_COUNT) {
        throw new Error(`Expected ${EXPECTED_PROBLEM_COUNT} problem resources, parsed ${parsedProblemCount}`);
    }

    return {
        schemaVersion: 1,
        source: {
            name: sourceName,
            sha256: crypto.createHash("sha256").update(sourceBytes).digest("hex").toUpperCase(),
        },
        problemCount: parsedProblemCount,
        problems,
    };
}

export function importLearningResources(inputPath = sourcePath, destinationPath = outputPath) {
    if (!inputPath || !fs.existsSync(inputPath)) {
        throw new Error("Usage: node scripts/import-jit-learning-resources.mjs <resource-list.md>");
    }
    const sourceBytes = fs.readFileSync(inputPath);
    const neetCodeDataset = JSON.parse(fs.readFileSync(neetCodeDatasetPath, "utf8"));
    const knownTitleSlugs = new Set(Object.values(neetCodeDataset.problems).map((problem) => problem.titleSlug));
    const output = parseLearningResources(sourceBytes, knownTitleSlugs, path.basename(inputPath));
    validateJitLearningDataset(output, knownTitleSlugs);

    atomicWriteFiles([{ path: destinationPath, content: `${JSON.stringify(output, null, 2)}\n` }], {
        validate: (stagedPaths) => {
            const staged = JSON.parse(fs.readFileSync(stagedPaths.get(destinationPath), "utf8"));
            validateJitLearningDataset(staged, knownTitleSlugs);
        },
    });
    console.log(`Wrote ${output.problemCount} learning-resource entries to ${path.relative(extensionRoot, destinationPath)}`);
    return output;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    importLearningResources();
}
