const SHA_PATTERN = /^[0-9a-f]{40}$/i;
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

