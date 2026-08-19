import { globalState } from "../../globalState";
import type { IProblem } from "../../shared";
import type { Mapping } from "../../types";
import { installedNeetCodeDataStore } from "./dataStore";
import { JitLearningDataset, NeetCodeDataset, NeetCodeProblemContent, NeetCodeProblemMetadata } from "./types";

interface NeetCodeServiceDataAccess {
    getIndex(): NeetCodeDataset;
    getContent(problem: NeetCodeProblemMetadata): NeetCodeProblemContent | undefined;
    getLearningDataset(): JitLearningDataset;
}

const installedDataAccess: NeetCodeServiceDataAccess = {
    getIndex: () => installedNeetCodeDataStore.getIndex(),
    getContent: (problem) => installedNeetCodeDataStore.getContent(problem),
    getLearningDataset: () => installedNeetCodeDataStore.getLearningDataset(),
};

export class NeetCodeService {
    private dataset?: NeetCodeDataset;
    private learningDataset?: JitLearningDataset;
    private problemByTitleSlug?: Record<string, NeetCodeProblemMetadata>;
    private questionNumberTitleSlugMapping?: Mapping;

    constructor(private readonly dataAccess: NeetCodeServiceDataAccess = installedDataAccess) {}

    public getProblemMetadata(problem: IProblem): NeetCodeProblemMetadata | undefined {
        const dataset = this.getDataset();
        const exactMatch = dataset.problems[problem.id];
        if (exactMatch) {
            return this.withDerivedMetadata(exactMatch);
        }

        const titleSlug = this.getTitleSlugByQuestionNumber(problem.id);
        if (!titleSlug) {
            return undefined;
        }

        const matchedProblem = this.getProblemByTitleSlug()[titleSlug];
        return matchedProblem ? this.withDerivedMetadata(matchedProblem) : undefined;
    }

    private getDataset(): NeetCodeDataset {
        if (!this.dataset) {
            this.dataset = this.dataAccess.getIndex();
        }
        return this.dataset;
    }

    private getLearningDataset(): JitLearningDataset {
        if (!this.learningDataset) {
            this.learningDataset = this.dataAccess.getLearningDataset();
        }
        return this.learningDataset;
    }

    private getProblemByTitleSlug(): Record<string, NeetCodeProblemMetadata> {
        if (!this.problemByTitleSlug) {
            const problemByTitleSlug: Record<string, NeetCodeProblemMetadata> = {};
            const dataset = this.getDataset();
            for (const problem of Object.values(dataset.problems)) {
                if (problem.titleSlug) {
                    problemByTitleSlug[problem.titleSlug] = problem;
                }
            }
            this.problemByTitleSlug = problemByTitleSlug;
        }

        return this.problemByTitleSlug;
    }

    private getTitleSlugByQuestionNumber(questionNumber: string): string | undefined {
        if (!this.questionNumberTitleSlugMapping) {
            const titleSlugQuestionNumberMapping = globalState.getTitleSlugQuestionNumberMapping();
            if (!titleSlugQuestionNumberMapping) {
                return undefined;
            }

            const questionNumberTitleSlugMapping: Mapping = {};
            for (const [titleSlug, mappedQuestionNumber] of Object.entries(titleSlugQuestionNumberMapping)) {
                questionNumberTitleSlugMapping[mappedQuestionNumber] = titleSlug;
            }
            this.questionNumberTitleSlugMapping = questionNumberTitleSlugMapping;
        }

        return this.questionNumberTitleSlugMapping[questionNumber];
    }

    private withDerivedSolutionUrl(problem: NeetCodeProblemMetadata): NeetCodeProblemMetadata {
        const solutionSlug = problem.solutionSlug || problem.titleSlug;
        if (problem.solutionUrl || !solutionSlug) {
            return problem;
        }

        const list = problem.neetcode150 ? "neetcode150" : problem.blind75 ? "blind75" : undefined;

        return {
            ...problem,
            solutionSlug,
            solutionUrl: list
                ? `https://neetcode.io/problems/${solutionSlug}/question?list=${list}`
                : `https://neetcode.io/problems/${solutionSlug}/question`,
        };
    }

    private withDerivedMetadata(problem: NeetCodeProblemMetadata): NeetCodeProblemMetadata {
        const metadata = this.withDerivedSolutionUrl(problem);
        const content = this.dataAccess.getContent(problem);
        const learningMarkdown = this.getLearningDataset().problems[problem.titleSlug]?.markdown;

        return {
            ...metadata,
            articleMarkdown: content?.articleMarkdown,
            hintMarkdown: content?.hintMarkdown,
            learningMarkdown,
        };
    }
}

export const neetCodeService: NeetCodeService = new NeetCodeService();
