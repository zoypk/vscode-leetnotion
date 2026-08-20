export type LearningPriority = "M" | "S" | "C" | "R";

export interface LearningResourceGroup {
    readonly priority: LearningPriority;
    readonly title: string;
    readonly markdown: string;
}

export interface ParsedLearningResources {
    readonly attemptMarkdown: string;
    readonly revealMarkdown?: string;
    readonly groups: readonly LearningResourceGroup[];
    readonly returnMarkdown?: string;
}

const GROUP_HEADING = /^###\s+(M|S|C|R)\s+[—-]\s+(.+)$/;

function stripLabel(markdown: string, label: string): string {
    return markdown.replace(new RegExp(`^\\*\\*${label}:\\*\\*\\s*`, "i"), "").trim();
}

export function parseLearningResources(markdown: string): ParsedLearningResources {
    const paragraphs = markdown.split(/\r?\n\s*\r?\n/).map((part) => part.trim()).filter(Boolean);
    const attempt: string[] = [];
    const reveal: string[] = [];
    const fallbackResources: string[] = [];
    const groups: { priority: LearningPriority; title: string; parts: string[] }[] = [];
    let returnMarkdown: string | undefined;
    let currentGroup: typeof groups[number] | undefined;
    let revealed = false;

    for (const paragraph of paragraphs) {
        if (/^\*\*Cue:\*\*/i.test(paragraph)) {
            attempt.push(stripLabel(paragraph, "Cue"));
            continue;
        }
        if (/^\*\*Reveal after an honest attempt:\*\*/i.test(paragraph)) {
            revealed = true;
            currentGroup = undefined;
            reveal.push(stripLabel(paragraph, "Reveal after an honest attempt"));
            continue;
        }
        if (/^\*\*Return:\*\*/i.test(paragraph)) {
            returnMarkdown = stripLabel(paragraph, "Return");
            currentGroup = undefined;
            continue;
        }
        const groupMatch = GROUP_HEADING.exec(paragraph);
        if (groupMatch) {
            currentGroup = { priority: groupMatch[1] as LearningPriority, title: groupMatch[2], parts: [] };
            groups.push(currentGroup);
            continue;
        }
        if (currentGroup) {
            currentGroup.parts.push(paragraph);
        } else if (!revealed || /^`Direct attempt`/.test(paragraph)) {
            attempt.push(paragraph);
        } else {
            fallbackResources.push(paragraph);
        }
    }

    if (fallbackResources.length > 0) {
        groups.push({ priority: "C", title: "Additional resources", parts: fallbackResources });
    }
    return {
        attemptMarkdown: attempt.join("\n\n"),
        revealMarkdown: reveal.length > 0 ? reveal.join("\n\n") : undefined,
        groups: groups.filter((group) => group.parts.length > 0).map((group) => ({
            priority: group.priority,
            title: group.title,
            markdown: group.parts.join("\n\n"),
        })),
        returnMarkdown,
    };
}
