import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateJitLearningDataset } from "./lib/neetcode-validation.mjs";
import { atomicWriteFiles } from "./lib/sync-utils.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDirectory, "..");
const defaultDatasetPath = path.join(extensionRoot, "data", "jit-learning-resources.json");
const neetCodeDatasetPath = path.join(extensionRoot, "data", "neetcode-index.json");
const sourcePath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : undefined;

const PRIORITY_ORDER = ["M", "S", "C", "R"];
const EXPECTED_JIT_VIDEO_COUNT = 38;
const EXPECTED_TAKEUFORWARD_COUNT = 113;
const EXPECTED_BASE_SOURCE_SHA256 = "02AE3E7ACD9F325D8250DF77B88B8FDD8F277B0430699DE0680137FE561CB3A4";

function cleanCell(value) {
    return value.trim().replace(/^\*\*|\*\*$/g, "").trim();
}

function priorityFromText(value) {
    const normalized = cleanCell(value);
    if (/^M\*/.test(normalized)) return { priority: "M", displayPriority: "M*" };
    const match = /^(M|S|C|R)\b/.exec(normalized);
    if (match) return { priority: match[1], displayPriority: match[1] };
    if (/^Direct attempt\b/i.test(normalized)) {
        return { priority: "DIRECT", displayPriority: "Direct attempt" };
    }
    throw new Error(`Unsupported priority value: ${value}`);
}

function normalizeRole(value) {
    return value
        .replace(/[▶🧱📖⏱🎥🧪💻↔🟡🛟]/gu, "")
        .replace(/\*\*/g, "")
        .replace(/[.—]+$/g, "")
        .trim()
        .toLocaleLowerCase("en-US");
}

function canonicalRole(value) {
    const normalized = normalizeRole(value);
    if (normalized.includes("start here") && normalized.includes("no pre-watch")) return "start here — no pre-watch";
    if (normalized.includes("start here")) return "start here";
    if (normalized.includes("active drill")) return "active drill";
    if (normalized.includes("core concept") && normalized.includes("correctness")) return "core concept / correctness";
    if (normalized.includes("concept video")) return "concept video";
    if (normalized.includes("reference")) return "reference";
    if (normalized.includes("visualize")) return "visualize";
    if (normalized.includes("implementation")) return "implementation";
    if (normalized.includes("alternative")) return "alternative";
    if (normalized.includes("optional depth") && normalized.includes("context")) return "optional depth / context";
    if (normalized.includes("rescue only")) return "rescue only";
    return normalized;
}

function extractLinks(markdown) {
    return Array.from(markdown.matchAll(/\[[^\]]+\]\((https:\/\/[^)]+)\)/g), (match) => match[1]);
}

function extractArtifactRole(markdown) {
    const match = /^.*?\*\*([^*]+)\*\*/u.exec(markdown.trim());
    return match?.[1]?.trim();
}

function findRoleClassification(role, roleClassifications) {
    const key = canonicalRole(role);
    const match = roleClassifications.find((entry) => canonicalRole(entry.role) === key);
    if (match) return match;
    throw new Error(`No role classification found for artifact role: ${role}`);
}

export function parsePriorityGuide(sourceText) {
    const lines = sourceText.split(/\r?\n/);
    const priorityLegend = {};
    const roleClassifications = [];
    const jitVideos = new Map();
    const takeUforwardByNeetCodeRow = new Map();
    let section = "";

    for (const line of lines) {
        if (line.startsWith("## Unified priority legend")) section = "legend";
        else if (line.startsWith("### Role-to-priority classification")) section = "roles";
        else if (line.startsWith("### Unique JIT video resources")) section = "jit-videos";
        else if (line.startsWith("### How the takeUforward playlist fits")) section = "";
        else if (line.startsWith("### Full annotated playlist")) section = "takeuforward";
        else if (line.startsWith("### Default operating rule")) section = "";

        if (section === "legend") {
            const match = /^\|\s*\*\*(M|S|C|R)\*\*\s*\|\s*([^|]+)\|\s*([^|]+)\|/.exec(line);
            if (match) {
                priorityLegend[match[1]] = { meaning: match[2].trim(), action: match[3].trim() };
            }
        } else if (section === "roles") {
            const match = /^\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/.exec(line);
            if (match && !/Artifact role|---/.test(match[1])) {
                roleClassifications.push({
                    role: cleanCell(match[1]),
                    ...priorityFromText(match[2]),
                    action: match[3].trim(),
                });
            }
        } else if (section === "jit-videos") {
            const match = /^\|\s*\*\*(M\*?|S|C|R)\*\*\s*\|\s*\[([^\]]+)\]\((https:\/\/[^)]+)\)\s*\|\s*(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|/.exec(line);
            if (match) {
                const priority = priorityFromText(match[1]);
                if (jitVideos.has(match[3])) {
                    throw new Error(`Duplicate JIT video URL ${match[3]}`);
                }
                jitVideos.set(match[3], {
                    ...priority,
                    title: match[2].trim(),
                    url: match[3],
                    usedInRows: Number(match[4]),
                    originalRoles: match[5].trim(),
                    guidance: match[6].trim(),
                });
            }
        } else if (section === "takeuforward") {
            const match = /^\|\s*(\d+)\s*\|\s*\*\*(M|S|C|R)\*\*\s*\|\s*\[([^\]]+)\]\((https:\/\/[^)]+)\)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*(\d+)\s*\|/.exec(line);
            if (match) {
                const neetCodeRow = Number(match[7]);
                if (takeUforwardByNeetCodeRow.has(neetCodeRow)) {
                    throw new Error(`Duplicate takeUforward mapping for NeetCode row ${neetCodeRow}`);
                }
                if (Array.from(takeUforwardByNeetCodeRow.values()).some((entry) => entry.position === Number(match[1]))) {
                    throw new Error(`Duplicate takeUforward position ${match[1]}`);
                }
                if (Array.from(takeUforwardByNeetCodeRow.values()).some((entry) => entry.url === match[4])) {
                    throw new Error(`Duplicate takeUforward URL ${match[4]}`);
                }
                takeUforwardByNeetCodeRow.set(neetCodeRow, {
                    position: Number(match[1]),
                    priority: match[2],
                    displayPriority: match[2],
                    title: match[3].trim(),
                    url: match[4],
                    section: match[5].trim(),
                    guidance: match[6].trim(),
                    neetCodeRow,
                });
            }
        }
    }

    if (Object.keys(priorityLegend).length !== 4) {
        throw new Error(`Expected 4 priority legend entries, parsed ${Object.keys(priorityLegend).length}`);
    }
    if (roleClassifications.length !== 11) {
        throw new Error(`Expected 11 role classifications, parsed ${roleClassifications.length}`);
    }
    if (jitVideos.size !== EXPECTED_JIT_VIDEO_COUNT) {
        throw new Error(`Expected ${EXPECTED_JIT_VIDEO_COUNT} JIT video classifications, parsed ${jitVideos.size}`);
    }
    if (takeUforwardByNeetCodeRow.size !== EXPECTED_TAKEUFORWARD_COUNT) {
        throw new Error(`Expected ${EXPECTED_TAKEUFORWARD_COUNT} takeUforward rows, parsed ${takeUforwardByNeetCodeRow.size}`);
    }
    const positions = Array.from(takeUforwardByNeetCodeRow.values()).map((entry) => entry.position).sort((a, b) => a - b);
    if (positions.some((position, index) => position !== index + 1)) {
        throw new Error("takeUforward positions must be the contiguous sequence 1 through 113");
    }

    return { priorityLegend, roleClassifications, jitVideos, takeUforwardByNeetCodeRow };
}

export function classifyProblemMarkdown(problem, guide) {
    const paragraphs = problem.markdown.split(/\r?\n\s*\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => !/^###\s+[MSCR]\s+[—-]\s+/.test(part))
        .filter((part) => !/^_Priority guidance:/.test(part))
        .filter((part) => !/^`(?:M|S|C|R)`\s+🎬\s+\*\*takeUforward anchor\*\*/.test(part))
        .map((part) => part.replace(/^`(?:M\*?|S|C|R|Direct attempt)`\s+/, ""));
    const cue = paragraphs.find((part) => part.startsWith("**Cue:**"));
    const reveal = paragraphs.find((part) => part.startsWith("**Reveal after an honest attempt:**"));
    const returnCheckpoint = paragraphs.find((part) => part.startsWith("**Return:**"));
    if (!cue || !reveal || !returnCheckpoint) {
        throw new Error(`Learning resource ${problem.titleSlug} is missing Cue, Reveal, or Return content`);
    }

    const grouped = { M: [], S: [], C: [], R: [] };
    const directAttempt = [];
    let classifiedJitArtifacts = 0;
    let matchedJitVideoUses = 0;
    const matchedUsesByUrl = new Map();

    for (const paragraph of paragraphs) {
        if (paragraph === cue || paragraph === reveal || paragraph === returnCheckpoint) continue;
        const role = extractArtifactRole(paragraph);
        if (!role) throw new Error(`Unable to identify artifact role for ${problem.titleSlug}: ${paragraph}`);
        const roleClassification = findRoleClassification(role, guide.roleClassifications);
        const videoMatches = extractLinks(paragraph).map((url) => guide.jitVideos.get(url)).filter(Boolean);
        const distinctVideoPriorities = new Set(videoMatches.map((entry) => entry.displayPriority));
        if (distinctVideoPriorities.size > 1) {
            throw new Error(`Artifact ${problem.titleSlug}/${role} matches conflicting JIT video priorities`);
        }
        const classification = videoMatches[0] ?? roleClassification;
        const prefix = `\`${classification.displayPriority}\``;
        const guidance = videoMatches[0]?.guidance ? `\n\n_Priority guidance: ${videoMatches[0].guidance}_` : "";
        const classified = `${prefix} ${paragraph}${guidance}`;
        if (classification.priority === "DIRECT") directAttempt.push(classified);
        else grouped[classification.priority].push(classified);
        classifiedJitArtifacts += 1;
        matchedJitVideoUses += videoMatches.length;
        for (const video of videoMatches) {
            matchedUsesByUrl.set(video.url, (matchedUsesByUrl.get(video.url) ?? 0) + 1);
        }
    }

    const takeUforward = guide.takeUforwardByNeetCodeRow.get(problem.sourceIndex);
    if (takeUforward) {
        grouped[takeUforward.priority].push(
            `\`${takeUforward.displayPriority}\` 🎬 **takeUforward anchor** — [${takeUforward.title}](${takeUforward.url}) — ${takeUforward.guidance}`,
        );
    }

    const output = [cue, ...directAttempt, reveal];
    for (const priority of PRIORITY_ORDER) {
        if (grouped[priority].length === 0) continue;
        output.push(`### ${priority} — ${guide.priorityLegend[priority].meaning}`);
        output.push(...grouped[priority]);
    }
    output.push(returnCheckpoint);

    return {
        markdown: output.join("\n\n"),
        classifiedJitArtifacts,
        matchedJitVideoUses,
        matchedUsesByUrl,
        takeUforwardCount: takeUforward ? 1 : 0,
    };
}

export function applyPriorityGuide(dataset, sourceBytes, sourceName) {
    if (dataset?.source?.sha256 !== EXPECTED_BASE_SOURCE_SHA256) {
        throw new Error(`Priority guide requires base JIT source ${EXPECTED_BASE_SOURCE_SHA256}, found ${dataset?.source?.sha256 ?? "missing"}`);
    }
    const guide = parsePriorityGuide(sourceBytes.toString("utf8"));
    const problems = {};
    let classifiedArtifactCount = 0;
    let matchedJitVideoUses = 0;
    let takeUforwardCount = 0;
    const matchedUsesByUrl = new Map();

    for (const [titleSlug, problem] of Object.entries(dataset.problems)) {
        const classified = classifyProblemMarkdown(problem, guide);
        problems[titleSlug] = { ...problem, markdown: classified.markdown };
        classifiedArtifactCount += classified.classifiedJitArtifacts;
        matchedJitVideoUses += classified.matchedJitVideoUses;
        for (const [url, count] of classified.matchedUsesByUrl) {
            matchedUsesByUrl.set(url, (matchedUsesByUrl.get(url) ?? 0) + count);
        }
        takeUforwardCount += classified.takeUforwardCount;
        const mapped = guide.takeUforwardByNeetCodeRow.get(problem.sourceIndex);
        if (mapped && mapped.section !== problem.section) {
            throw new Error(`takeUforward row ${mapped.position} section ${mapped.section} does not match ${problem.titleSlug} section ${problem.section}`);
        }
    }

    const expectedJitVideoUses = Array.from(guide.jitVideos.values())
        .reduce((total, video) => total + video.usedInRows, 0);
    if (matchedJitVideoUses !== expectedJitVideoUses) {
        throw new Error(`Expected ${expectedJitVideoUses} classified JIT video uses, matched ${matchedJitVideoUses}`);
    }
    for (const video of guide.jitVideos.values()) {
        const actual = matchedUsesByUrl.get(video.url) ?? 0;
        if (actual !== video.usedInRows) {
            throw new Error(`JIT video ${video.url} declares ${video.usedInRows} uses but matched ${actual}`);
        }
    }
    if (takeUforwardCount !== EXPECTED_TAKEUFORWARD_COUNT) {
        throw new Error(`Expected ${EXPECTED_TAKEUFORWARD_COUNT} mapped takeUforward artifacts, attached ${takeUforwardCount}`);
    }

    return {
        ...dataset,
        classificationSource: {
            name: sourceName,
            sha256: crypto.createHash("sha256").update(sourceBytes).digest("hex").toUpperCase(),
        },
        priorityLegend: guide.priorityLegend,
        classifiedArtifactCount,
        jitVideoUseCount: matchedJitVideoUses,
        takeUforwardCount,
        problems,
    };
}

export function importPriorityGuide(inputPath = sourcePath, datasetPath = defaultDatasetPath) {
    if (!inputPath || !fs.existsSync(inputPath)) {
        throw new Error("Usage: node scripts/apply-learning-priority-guide.mjs <combined-priority-guide.md>");
    }
    const sourceBytes = fs.readFileSync(inputPath);
    const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
    const neetCodeDataset = JSON.parse(fs.readFileSync(neetCodeDatasetPath, "utf8"));
    const knownTitleSlugs = new Set(Object.values(neetCodeDataset.problems).map((problem) => problem.titleSlug));
    const output = applyPriorityGuide(dataset, sourceBytes, path.basename(inputPath));
    validateJitLearningDataset(output, knownTitleSlugs);

    atomicWriteFiles([{ path: datasetPath, content: `${JSON.stringify(output, null, 2)}\n` }], {
        validate: (stagedPaths) => {
            const staged = JSON.parse(fs.readFileSync(stagedPaths.get(datasetPath), "utf8"));
            validateJitLearningDataset(staged, knownTitleSlugs);
        },
    });
    console.log(`Classified ${output.classifiedArtifactCount} JIT artifacts and attached ${output.takeUforwardCount} takeUforward artifacts`);
    return output;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    importPriorityGuide();
}
