const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const CONTENT_PATH_PATTERN = /^neetcode-content\/(\d+)\.json$/;
const HTTPS_URL_PATTERN = /^https:\/\//;
const FORBIDDEN_INDEX_FIELDS = ["articleMarkdown", "hintMarkdown", "learningMarkdown"];

function fail(label, errors) {
    if (errors.length > 0) {
        throw new Error(`${label} validation failed:\n- ${errors.join("\n- ")}`);
    }
}

function nonemptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

export function validateNeetCodeDataset(index, contents) {
    const errors = [];
    const problems = index?.problems && typeof index.problems === "object" && !Array.isArray(index.problems)
        ? index.problems
        : {};
    const contentMap = contents instanceof Map ? contents : new Map(Object.entries(contents || {}));

    if (index?.schemaVersion !== 2) {
        errors.push("index schemaVersion must be 2");
    }
    if (!nonemptyString(index?.generatedAt) || Number.isNaN(Date.parse(index.generatedAt))) {
        errors.push("index generatedAt must be an ISO-compatible timestamp");
    }
    if (index?.source?.repository !== "https://github.com/neetcode-gh/leetcode") {
        errors.push("index source.repository must be the NeetCode GitHub repository");
    }
    if (!SHA_PATTERN.test(index?.source?.revision || "")) {
        errors.push("index source.revision must be a 40-character Git SHA");
    }

    const problemEntries = Object.entries(problems);
    const titleSlugs = new Set();
    const referencedContent = new Set();
    let neetcode150Count = 0;
    let blind75Count = 0;

    for (const [questionId, problem] of problemEntries) {
        const prefix = `problem ${questionId}`;
        if (!/^(0|[1-9]\d*)$/.test(questionId)) {
            errors.push(`${prefix} has a nonnumeric index key`);
        }
        if (!problem || typeof problem !== "object" || Array.isArray(problem)) {
            errors.push(`${prefix} must be an object`);
            continue;
        }
        if (problem.questionId !== questionId) {
            errors.push(`${prefix} questionId does not match its index key`);
        }
        if (!nonemptyString(problem.title)) {
            errors.push(`${prefix} title must be nonempty`);
        }
        const codeMatch = /^(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(problem.code || "");
        if (!codeMatch || String(Number.parseInt(codeMatch[1], 10)) !== questionId) {
            errors.push(`${prefix} code must contain its numeric ID and a safe lowercase slug`);
        }
        if (!nonemptyString(problem.titleSlug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(problem.titleSlug)) {
            errors.push(`${prefix} titleSlug is invalid`);
        } else if (titleSlugs.has(problem.titleSlug)) {
            errors.push(`${prefix} duplicates titleSlug ${problem.titleSlug}`);
        } else {
            titleSlugs.add(problem.titleSlug);
        }
        for (const forbiddenField of FORBIDDEN_INDEX_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(problem, forbiddenField)) {
                errors.push(`${prefix} embeds ${forbiddenField}; large content must remain in a per-problem file`);
            }
        }
        if (problem.pattern !== undefined && !nonemptyString(problem.pattern)) {
            errors.push(`${prefix} pattern must be a nonempty string when present`);
        }
        if (problem.difficulty !== undefined && !["Easy", "Medium", "Hard"].includes(problem.difficulty)) {
            errors.push(`${prefix} difficulty must be Easy, Medium, or Hard when present`);
        }
        if (problem.solutionSlug !== undefined
            && (!nonemptyString(problem.solutionSlug)
                || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(problem.solutionSlug))) {
            errors.push(`${prefix} solutionSlug must be a safe lowercase slug when present`);
        }
        if (typeof problem.neetcode150 !== "boolean" || typeof problem.blind75 !== "boolean") {
            errors.push(`${prefix} neetcode150 and blind75 must be booleans`);
        }
        for (const field of ["problemUrl", "solutionUrl", "videoUrl"]) {
            if (problem[field] !== undefined && !HTTPS_URL_PATTERN.test(problem[field])) {
                errors.push(`${prefix} ${field} must use HTTPS`);
            }
        }
        if (problem.neetcode150 === true) {
            neetcode150Count += 1;
        }
        if (problem.blind75 === true) {
            blind75Count += 1;
        }

        if (problem.contentFile !== undefined) {
            const match = CONTENT_PATH_PATTERN.exec(problem.contentFile);
            if (!match || match[1] !== questionId) {
                errors.push(`${prefix} contentFile must be neetcode-content/${questionId}.json`);
            } else {
                referencedContent.add(problem.contentFile);
                const content = contentMap.get(problem.contentFile);
                if (!content) {
                    errors.push(`${prefix} references missing content file ${problem.contentFile}`);
                } else {
                    if (content.schemaVersion !== 1) {
                        errors.push(`${problem.contentFile} schemaVersion must be 1`);
                    }
                    if (content.questionId !== questionId || content.titleSlug !== problem.titleSlug) {
                        errors.push(`${problem.contentFile} identity does not match ${questionId}/${problem.titleSlug}`);
                    }
                    if (!nonemptyString(content.articleMarkdown) && !nonemptyString(content.hintMarkdown)) {
                        errors.push(`${problem.contentFile} must contain an article or hint`);
                    }
                    if (content.articleMarkdown !== undefined && !nonemptyString(content.articleMarkdown)) {
                        errors.push(`${problem.contentFile} articleMarkdown must be a nonempty string when present`);
                    }
                    if (content.hintMarkdown !== undefined && !nonemptyString(content.hintMarkdown)) {
                        errors.push(`${problem.contentFile} hintMarkdown must be a nonempty string when present`);
                    }
                }
            }
        }
    }

    for (const contentPath of contentMap.keys()) {
        if (!CONTENT_PATH_PATTERN.test(contentPath)) {
            errors.push(`unexpected or unsafe content path ${contentPath}`);
        } else if (!referencedContent.has(contentPath)) {
            errors.push(`unreferenced content file ${contentPath}`);
        }
    }

    if (index?.problemCount !== problemEntries.length) {
        errors.push(`problemCount ${index?.problemCount} does not match ${problemEntries.length} records`);
    }
    if (index?.neetcode150Count !== neetcode150Count || neetcode150Count !== 150) {
        errors.push(`NeetCode 150 count must be 150 (metadata ${index?.neetcode150Count}, actual ${neetcode150Count})`);
    }
    if (index?.blind75Count !== blind75Count || blind75Count !== 75) {
        errors.push(`Blind 75 count must be 75 (metadata ${index?.blind75Count}, actual ${blind75Count})`);
    }

    const quadTree = problems["427"];
    if (!quadTree
        || quadTree.questionId !== "427"
        || quadTree.titleSlug !== "construct-quad-tree"
        || quadTree.code !== "0427-construct-quad-tree"
        || quadTree.contentFile !== "neetcode-content/427.json") {
        errors.push("Construct Quad Tree must be ID 427, slug construct-quad-tree, code 0427-construct-quad-tree, with content file 427.json");
    }
    const quadContent = contentMap.get("neetcode-content/427.json");
    if (!quadContent || quadContent.questionId !== "427" || quadContent.titleSlug !== "construct-quad-tree") {
        errors.push("Construct Quad Tree content must contain only the 427/construct-quad-tree identity");
    }

    fail("NeetCode data", errors);
    return {
        problemCount: problemEntries.length,
        contentFileCount: contentMap.size,
        neetcode150Count,
        blind75Count,
        titleSlugs,
    };
}

export function validateJitLearningDataset(dataset, knownTitleSlugs) {
    const errors = [];
    const problems = dataset?.problems && typeof dataset.problems === "object" && !Array.isArray(dataset.problems)
        ? dataset.problems
        : {};
    const problemEntries = Object.entries(problems);
    const sourceIndexes = new Set();

    if (dataset?.schemaVersion !== 1) {
        errors.push("schemaVersion must be 1");
    }
    if (!nonemptyString(dataset?.source?.name)
        || dataset.source.name.includes("/")
        || dataset.source.name.includes("\\")) {
        errors.push("source.name must be a nonempty basename");
    }
    if (!SHA256_PATTERN.test(dataset?.source?.sha256 || "")) {
        errors.push("source.sha256 must be a 64-character SHA-256 digest");
    }
    const hasClassification = dataset?.classificationSource !== undefined
        || dataset?.priorityLegend !== undefined
        || dataset?.classifiedArtifactCount !== undefined
        || dataset?.jitVideoUseCount !== undefined
        || dataset?.takeUforwardCount !== undefined;
    if (hasClassification) {
        if (!nonemptyString(dataset?.classificationSource?.name)
            || dataset.classificationSource.name.includes("/")
            || dataset.classificationSource.name.includes("\\")) {
            errors.push("classificationSource.name must be a nonempty basename");
        }
        if (!SHA256_PATTERN.test(dataset?.classificationSource?.sha256 || "")) {
            errors.push("classificationSource.sha256 must be a 64-character SHA-256 digest");
        }
        for (const priority of ["M", "S", "C", "R"]) {
            if (!nonemptyString(dataset?.priorityLegend?.[priority]?.meaning)
                || !nonemptyString(dataset?.priorityLegend?.[priority]?.action)) {
                errors.push(`priorityLegend.${priority} must contain nonempty meaning and action`);
            }
        }
        for (const field of ["classifiedArtifactCount", "jitVideoUseCount", "takeUforwardCount"]) {
            if (!Number.isInteger(dataset?.[field]) || dataset[field] < 0) {
                errors.push(`${field} must be a nonnegative integer`);
            }
        }
    }
    if (dataset?.problemCount !== 250 || problemEntries.length !== 250) {
        errors.push(`problem count must be 250 (metadata ${dataset?.problemCount}, actual ${problemEntries.length})`);
    }

    for (const [titleSlug, problem] of problemEntries) {
        const prefix = `JIT problem ${titleSlug}`;
        if (!problem || typeof problem !== "object" || Array.isArray(problem)) {
            errors.push(`${prefix} must be an object`);
            continue;
        }
        if (problem.titleSlug !== titleSlug) {
            errors.push(`${prefix} titleSlug does not match its record key`);
        }
        if (!knownTitleSlugs?.has(titleSlug)) {
            errors.push(`${prefix} is not present in the NeetCode index`);
        }
        if (!Number.isInteger(problem.sourceIndex) || problem.sourceIndex < 1 || problem.sourceIndex > 250) {
            errors.push(`${prefix} sourceIndex must be an integer from 1 through 250`);
        } else if (sourceIndexes.has(problem.sourceIndex)) {
            errors.push(`${prefix} duplicates sourceIndex ${problem.sourceIndex}`);
        } else {
            sourceIndexes.add(problem.sourceIndex);
        }
        for (const field of ["title", "titleSlug", "section", "difficulty", "markdown"]) {
            if (!nonemptyString(problem[field])) {
                errors.push(`${prefix} ${field} must be nonempty`);
            }
        }
        if (!new Set(["Easy", "Medium", "Hard"]).has(problem.difficulty)) {
            errors.push(`${prefix} difficulty must be Easy, Medium, or Hard`);
        }
        for (const link of (problem.markdown || "").matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
            if (!HTTPS_URL_PATTERN.test(link[1])) {
                errors.push(`${prefix} contains non-HTTPS learning link ${link[1]}`);
            }
        }
        if (/http:\/\//i.test(problem.markdown || "")) {
            errors.push(`${prefix} contains an insecure HTTP URL`);
        }
    }

    for (let index = 1; index <= 250; index += 1) {
        if (!sourceIndexes.has(index)) {
            errors.push(`sourceIndex ${index} is missing`);
        }
    }

    if (hasClassification) {
        const allMarkdown = problemEntries.map(([, problem]) => problem?.markdown || "").join("\n");
        const priorityLines = Array.from(allMarkdown.matchAll(/^`(?:M\*?|S|C|R|Direct attempt)`\s/gm)).length;
        const takeUforwardLines = Array.from(allMarkdown.matchAll(/^`(?:M|S|C|R)`\s+🎬\s+\*\*takeUforward anchor\*\*/gm)).length;
        if (takeUforwardLines !== dataset.takeUforwardCount) {
            errors.push(`takeUforwardCount metadata ${dataset.takeUforwardCount} does not match ${takeUforwardLines} artifacts`);
        }
        if (priorityLines - takeUforwardLines !== dataset.classifiedArtifactCount) {
            errors.push(`classifiedArtifactCount metadata ${dataset.classifiedArtifactCount} does not match ${priorityLines - takeUforwardLines} artifacts`);
        }
        if (dataset.takeUforwardCount !== 113) {
            errors.push(`takeUforwardCount must be 113, found ${dataset.takeUforwardCount}`);
        }
        if (dataset.jitVideoUseCount !== 235) {
            errors.push(`jitVideoUseCount must be 235, found ${dataset.jitVideoUseCount}`);
        }
    }

    fail("JIT learning resources", errors);
    return { problemCount: problemEntries.length };
}
