import * as fs from "fs";
import * as path from "path";
import {
    JitLearningDataset,
    NeetCodeDataset,
    NeetCodeProblemContent,
    NeetCodeProblemMetadata,
} from "./types";

const CONTENT_PATH_PATTERN = /^neetcode-content\/(\d+)\.json$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const DIFFICULTIES = new Set(["Easy", "Medium", "Hard"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

export class NeetCodeDataStore {
    private index?: NeetCodeDataset;
    private learningDataset?: JitLearningDataset;
    private readonly contentCache = new Map<string, NeetCodeProblemContent>();

    constructor(private readonly dataRoot: string) {}

    public getIndex(): NeetCodeDataset {
        if (!this.index) {
            this.index = this.validateIndex(
                this.readJson("neetcode-index.json", "NeetCode metadata index"),
            );
        }
        return this.index;
    }

    public getLearningDataset(): JitLearningDataset {
        if (!this.learningDataset) {
            const learningDataset = this.validateLearningDataset(
                this.readJson("jit-learning-resources.json", "JIT learning-resource dataset"),
            );
            const knownTitleSlugs = new Set(Object.values(this.getIndex().problems).map((problem) => problem.titleSlug));
            for (const titleSlug of Object.keys(learningDataset.problems)) {
                if (!knownTitleSlugs.has(titleSlug)) {
                    throw this.invalidDataError(
                        "jit-learning-resources.json",
                        `JIT problem ${titleSlug} is missing from neetcode-index.json`,
                    );
                }
            }
            this.learningDataset = learningDataset;
        }
        return this.learningDataset;
    }

    public getContent(problem: NeetCodeProblemMetadata): NeetCodeProblemContent | undefined {
        if (!problem.contentFile) {
            return undefined;
        }
        const match = CONTENT_PATH_PATTERN.exec(problem.contentFile);
        if (!match || match[1] !== problem.questionId) {
            throw this.invalidDataError(
                "neetcode-index.json",
                `unsafe or mismatched content path ${JSON.stringify(problem.contentFile)} for problem ${problem.questionId}`,
            );
        }

        let content = this.contentCache.get(problem.contentFile);
        if (!content) {
            const loadedContent = this.readJson(problem.contentFile, `NeetCode content for problem ${problem.questionId}`);
            if (!isRecord(loadedContent)
                || loadedContent.schemaVersion !== 1
                || loadedContent.questionId !== problem.questionId
                || loadedContent.titleSlug !== problem.titleSlug
                || (loadedContent.articleMarkdown !== undefined && !isNonemptyString(loadedContent.articleMarkdown))
                || (loadedContent.hintMarkdown !== undefined && !isNonemptyString(loadedContent.hintMarkdown))
                || (!isNonemptyString(loadedContent.articleMarkdown) && !isNonemptyString(loadedContent.hintMarkdown))) {
                throw this.invalidDataError(
                    problem.contentFile,
                    `content identity does not match index entry ${problem.questionId}/${problem.titleSlug}`,
                );
            }
            content = loadedContent as unknown as NeetCodeProblemContent;
            this.contentCache.set(problem.contentFile, content);
        }
        return content;
    }

    private validateIndex(value: unknown): NeetCodeDataset {
        const relativePath = "neetcode-index.json";
        if (!isRecord(value)
            || value.schemaVersion !== 2
            || !isNonemptyString(value.generatedAt)
            || Number.isNaN(Date.parse(value.generatedAt))
            || !isRecord(value.source)
            || value.source.repository !== "https://github.com/neetcode-gh/leetcode"
            || !GIT_SHA_PATTERN.test(String(value.source.revision || ""))
            || !isRecord(value.problems)) {
            throw this.invalidDataError(relativePath, "expected a complete schemaVersion 2 index with provenance and a problems object");
        }

        const entries = Object.entries(value.problems);
        const slugs = new Set<string>();
        let neetcode150Count = 0;
        let blind75Count = 0;
        for (const [questionId, rawProblem] of entries) {
            if (!/^(0|[1-9]\d*)$/.test(questionId) || !isRecord(rawProblem)) {
                throw this.invalidDataError(relativePath, `problem ${questionId} must be an object under a numeric ID`);
            }
            const codeMatch = /^(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(String(rawProblem.code || ""));
            if (rawProblem.questionId !== questionId
                || !isNonemptyString(rawProblem.title)
                || !isNonemptyString(rawProblem.titleSlug)
                || !SLUG_PATTERN.test(rawProblem.titleSlug)
                || !codeMatch
                || String(Number.parseInt(codeMatch[1], 10)) !== questionId
                || typeof rawProblem.neetcode150 !== "boolean"
                || typeof rawProblem.blind75 !== "boolean"
                || Object.prototype.hasOwnProperty.call(rawProblem, "articleMarkdown")
                || Object.prototype.hasOwnProperty.call(rawProblem, "hintMarkdown")
                || Object.prototype.hasOwnProperty.call(rawProblem, "learningMarkdown")
                || (rawProblem.pattern !== undefined && !isNonemptyString(rawProblem.pattern))
                || (rawProblem.difficulty !== undefined && !DIFFICULTIES.has(String(rawProblem.difficulty)))
                || (rawProblem.solutionSlug !== undefined
                    && (!isNonemptyString(rawProblem.solutionSlug) || !SLUG_PATTERN.test(rawProblem.solutionSlug)))) {
                throw this.invalidDataError(relativePath, `problem ${questionId} has malformed identity, list flags, or metadata fields`);
            }
            if (slugs.has(rawProblem.titleSlug)) {
                throw this.invalidDataError(relativePath, `problem ${questionId} duplicates titleSlug ${rawProblem.titleSlug}`);
            }
            slugs.add(rawProblem.titleSlug);
            for (const urlField of ["problemUrl", "solutionUrl", "videoUrl"]) {
                if (rawProblem[urlField] !== undefined
                    && (!isNonemptyString(rawProblem[urlField]) || !rawProblem[urlField].startsWith("https://"))) {
                    throw this.invalidDataError(relativePath, `problem ${questionId} has an invalid ${urlField}`);
                }
            }
            if (rawProblem.contentFile !== undefined) {
                const contentMatch = CONTENT_PATH_PATTERN.exec(String(rawProblem.contentFile));
                if (!contentMatch || contentMatch[1] !== questionId) {
                    throw this.invalidDataError(relativePath, `problem ${questionId} has an unsafe or mismatched content path`);
                }
            }
            if (rawProblem.neetcode150) { neetcode150Count += 1; }
            if (rawProblem.blind75) { blind75Count += 1; }
        }

        if (entries.length === 0
            || value.problemCount !== entries.length
            || value.neetcode150Count !== neetcode150Count
            || value.blind75Count !== blind75Count
            || neetcode150Count !== 150
            || blind75Count !== 75) {
            throw this.invalidDataError(
                relativePath,
                `record/list counts are incomplete (records ${entries.length}, NeetCode 150 ${neetcode150Count}, Blind 75 ${blind75Count})`,
            );
        }
        const quadTree = value.problems["427"];
        if (!isRecord(quadTree)
            || quadTree.questionId !== "427"
            || quadTree.titleSlug !== "construct-quad-tree"
            || quadTree.code !== "0427-construct-quad-tree"
            || quadTree.contentFile !== "neetcode-content/427.json") {
            throw this.invalidDataError(
                relativePath,
                "Construct Quad Tree must be 427/construct-quad-tree/0427-construct-quad-tree with content 427.json",
            );
        }
        return value as unknown as NeetCodeDataset;
    }

    private validateLearningDataset(value: unknown): JitLearningDataset {
        const relativePath = "jit-learning-resources.json";
        if (!isRecord(value)
            || value.schemaVersion !== 1
            || !isRecord(value.source)
            || !isNonemptyString(value.source.name)
            || value.source.name.includes("/")
            || value.source.name.includes("\\")
            || !SHA256_PATTERN.test(String(value.source.sha256 || ""))
            || !isRecord(value.problems)) {
            throw this.invalidDataError(relativePath, "expected schemaVersion 1 with source name/hash and a problems object");
        }

        const entries = Object.entries(value.problems);
        const sourceIndexes = new Set<number>();
        for (const [titleSlug, rawProblem] of entries) {
            if (!isRecord(rawProblem)
                || rawProblem.titleSlug !== titleSlug
                || !SLUG_PATTERN.test(titleSlug)
                || !Number.isInteger(rawProblem.sourceIndex)
                || Number(rawProblem.sourceIndex) < 1
                || Number(rawProblem.sourceIndex) > 150
                || !isNonemptyString(rawProblem.title)
                || !isNonemptyString(rawProblem.section)
                || !DIFFICULTIES.has(String(rawProblem.difficulty))
                || !isNonemptyString(rawProblem.markdown)) {
                throw this.invalidDataError(relativePath, `JIT problem ${titleSlug} has malformed identity or learning metadata`);
            }
            const sourceIndex = Number(rawProblem.sourceIndex);
            if (sourceIndexes.has(sourceIndex)) {
                throw this.invalidDataError(relativePath, `JIT problem ${titleSlug} duplicates sourceIndex ${sourceIndex}`);
            }
            sourceIndexes.add(sourceIndex);
            const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
            let link = linkPattern.exec(rawProblem.markdown);
            while (link !== null) {
                if (!link[1].startsWith("https://")) {
                    throw this.invalidDataError(relativePath, `JIT problem ${titleSlug} contains a non-HTTPS link`);
                }
                link = linkPattern.exec(rawProblem.markdown);
            }
            if (/http:\/\//i.test(rawProblem.markdown)) {
                throw this.invalidDataError(relativePath, `JIT problem ${titleSlug} contains an insecure HTTP URL`);
            }
        }
        if (value.problemCount !== 150 || entries.length !== 150 || sourceIndexes.size !== 150) {
            throw this.invalidDataError(relativePath, `expected exactly 150 complete JIT records, found ${entries.length}`);
        }
        return value as unknown as JitLearningDataset;
    }

    private readJson(relativePath: string, description: string): unknown {
        const absolutePath = path.resolve(this.dataRoot, relativePath);
        const relativeResolvedPath = path.relative(path.resolve(this.dataRoot), absolutePath);
        if (relativeResolvedPath.startsWith("..") || path.isAbsolute(relativeResolvedPath)) {
            throw this.invalidDataError(relativePath, "path escapes the extension data directory");
        }

        try {
            return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as unknown;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(
                `Unable to load ${description} at ${absolutePath}: ${detail}. `
                + "Reinstall the extension or run npm run validate:data in the extension source tree.",
            );
        }
    }

    private invalidDataError(relativePath: string, detail: string): Error {
        return new Error(
            `Invalid installed NeetCode data at ${path.resolve(this.dataRoot, relativePath)}: ${detail}. `
            + "Reinstall the extension or run npm run validate:data in the extension source tree.",
        );
    }
}

function resolveInstalledDataRoot(): string {
    const bundledDataRoot = path.resolve(__dirname, "../../data");
    const compiledModuleDataRoot = path.resolve(__dirname, "../../../data");
    return fs.existsSync(path.join(bundledDataRoot, "neetcode-index.json"))
        ? bundledDataRoot
        : compiledModuleDataRoot;
}

export const installedNeetCodeDataStore = new NeetCodeDataStore(resolveInstalledDataRoot());
