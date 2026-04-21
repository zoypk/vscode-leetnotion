import { globalState } from "../../globalState";
import { IProblem } from "../../shared";
import { Mapping } from "../../types";
import { getNeetCodeDataset } from "../../utils/dataUtils";
import { NeetCodeDataset, NeetCodeProblemMetadata } from "./types";

class NeetCodeService {
    private dataset?: NeetCodeDataset;
    private problemByTitleSlug?: Record<string, NeetCodeProblemMetadata>;
    private questionNumberTitleSlugMapping?: Mapping;

    public getProblemMetadata(problem: IProblem): NeetCodeProblemMetadata | undefined {
        const dataset = this.getDataset();
        const exactMatch = dataset.problems[problem.id];
        if (exactMatch) {
            return this.withDerivedSolutionUrl(exactMatch);
        }

        const titleSlug = this.getTitleSlugByQuestionNumber(problem.id);
        if (!titleSlug) {
            return undefined;
        }

        const matchedProblem = this.getProblemByTitleSlug()[titleSlug];
        return matchedProblem ? this.withDerivedSolutionUrl(matchedProblem) : undefined;
    }

    private getDataset(): NeetCodeDataset {
        if (!this.dataset) {
            this.dataset = getNeetCodeDataset();
        }
        return this.dataset;
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
}

export const neetCodeService: NeetCodeService = new NeetCodeService();
