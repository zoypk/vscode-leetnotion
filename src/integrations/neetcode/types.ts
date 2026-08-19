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
    contentFile?: string;
    articleMarkdown?: string;
    hintMarkdown?: string;
    learningMarkdown?: string;
    neetcode150?: boolean;
    blind75?: boolean;
}

export interface NeetCodeDatasetProvenance {
    repository: string;
    revision: string;
}

export interface NeetCodeDataset {
    schemaVersion: 2;
    generatedAt: string;
    source: NeetCodeDatasetProvenance;
    problemCount: number;
    neetcode150Count: number;
    blind75Count: number;
    problems: Record<string, NeetCodeProblemMetadata>;
}

export interface NeetCodeProblemContent {
    schemaVersion: 1;
    questionId: string;
    titleSlug: string;
    articleMarkdown?: string;
    hintMarkdown?: string;
}

export interface JitLearningProblemMetadata {
    sourceIndex: number;
    title: string;
    titleSlug: string;
    section: string;
    difficulty: string;
    markdown: string;
}

export interface JitLearningDataset {
    schemaVersion: 1;
    source: {
        name: string;
        sha256: string;
    };
    problemCount: number;
    problems: Record<string, JitLearningProblemMetadata>;
}
