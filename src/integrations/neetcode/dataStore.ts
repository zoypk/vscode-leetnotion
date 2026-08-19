import * as fs from "fs";
import * as path from "path";
import {
    JitLearningDataset,
    NeetCodeDataset,
    NeetCodeProblemContent,
    NeetCodeProblemMetadata,
} from "./types";

const CONTENT_PATH_PATTERN = /^neetcode-content\/(\d+)\.json$/;

export class NeetCodeDataStore {
    private index?: NeetCodeDataset;
    private learningDataset?: JitLearningDataset;
    private readonly contentCache = new Map<string, NeetCodeProblemContent>();

    constructor(private readonly dataRoot: string) {}

    public getIndex(): NeetCodeDataset {
        if (!this.index) {
            this.index = this.readJson<NeetCodeDataset>("neetcode-index.json", "NeetCode metadata index");
            if (this.index.schemaVersion !== 2 || !this.index.problems || typeof this.index.problems !== "object") {
                throw this.invalidDataError("neetcode-index.json", "expected schemaVersion 2 with a problems object");
            }
        }
        return this.index;
    }

    public getLearningDataset(): JitLearningDataset {
        if (!this.learningDataset) {
            this.learningDataset = this.readJson<JitLearningDataset>(
                "jit-learning-resources.json",
                "JIT learning-resource dataset",
            );
            if (this.learningDataset.schemaVersion !== 1
                || !this.learningDataset.problems
                || typeof this.learningDataset.problems !== "object") {
                throw this.invalidDataError(
                    "jit-learning-resources.json",
                    "expected schemaVersion 1 with a problems object",
                );
            }
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
            content = this.readJson<NeetCodeProblemContent>(problem.contentFile, `NeetCode content for problem ${problem.questionId}`);
            if (content.schemaVersion !== 1
                || content.questionId !== problem.questionId
                || content.titleSlug !== problem.titleSlug) {
                throw this.invalidDataError(
                    problem.contentFile,
                    `content identity does not match index entry ${problem.questionId}/${problem.titleSlug}`,
                );
            }
            this.contentCache.set(problem.contentFile, content);
        }
        return content;
    }

    private readJson<T>(relativePath: string, description: string): T {
        const absolutePath = path.resolve(this.dataRoot, relativePath);
        const relativeResolvedPath = path.relative(path.resolve(this.dataRoot), absolutePath);
        if (relativeResolvedPath.startsWith("..") || path.isAbsolute(relativeResolvedPath)) {
            throw this.invalidDataError(relativePath, "path escapes the extension data directory");
        }

        try {
            return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
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
