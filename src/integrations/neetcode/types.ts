export interface NeetCodeProblemMetadata {
    questionId: string;
    title: string;
    titleSlug: string;
    code?: string;
    pattern?: string;
    difficulty?: string;
    problemUrl?: string;
    solutionSlug?: string;
    solutionUrl?: string;
    videoUrl?: string;
    articleMarkdown?: string;
    hintMarkdown?: string;
    neetcode150?: boolean;
    blind75?: boolean;
}

export interface NeetCodeDataset {
    generatedAt: string;
    sourceRepo: string;
    problems: Record<string, NeetCodeProblemMetadata>;
}
