const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const scriptUrl = pathToFileURL(path.resolve(__dirname, "..", "scripts", "apply-learning-priority-guide.mjs")).href;

function guideFixture() {
    const legend = [
        ["M", "Core anchor"], ["S", "Specialty anchor"], ["C", "Complementary"], ["R", "Rescue only"],
    ].map(([key, meaning]) => `| **${key}** | ${meaning} | ${meaning} action. |`).join("\n");
    const roles = [
        ["▶ **Start here**", "M, but conditional"], ["🧪 **Active drill**", "M — do, not watch"],
        ["🧱 **Core concept / correctness**", "S"], ["⏱ / 🎥 **Concept video**", "S"],
        ["📖 **Reference**", "C"], ["🎥 **Visualize**", "C"], ["💻 **Implementation**", "C"],
        ["↔ **Alternative**", "C"], ["🟡 **Optional depth / context**", "C"],
        ["🛟 **Rescue only**", "R"], ["▶ **Start here — no pre-watch**", "Direct attempt"],
    ].map(([role, priority]) => `| ${role} | ${priority} | Use it deliberately. |`).join("\n");
    const videos = Array.from({ length: 38 }, (_, index) =>
        `| **${index === 0 ? "M*" : "C"}** | [Video ${index + 1}](https://example.com/jit-${index + 1}) | ${index === 0 ? 1 : 0} | Concept video | Guidance ${index + 1}. |`,
    ).join("\n");
    const take = Array.from({ length: 113 }, (_, index) =>
        `| ${index + 1} | **${index === 0 ? "S" : "C"}** | [Take ${index + 1}](https://example.com/take-${index + 1}) | Arrays | Take guidance ${index + 1}. | ${index + 1} |`,
    ).join("\n");
    return [
        "## Unified priority legend", legend,
        "### Role-to-priority classification", roles,
        "### Unique JIT video resources, deduplicated", videos,
        "### How the takeUforward playlist fits", "Text.",
        "### Full annotated playlist", take,
        "### Default operating rule",
    ].join("\n");
}

test("parses the complete guide contract and applies URL overrides plus mapped takeUforward artifacts", async () => {
    const { parsePriorityGuide, classifyProblemMarkdown } = await import(scriptUrl);
    const guide = parsePriorityGuide(guideFixture());
    assert.equal(guide.jitVideos.size, 38);
    assert.equal(guide.takeUforwardByNeetCodeRow.size, 113);

    const result = classifyProblemMarkdown({
        sourceIndex: 1,
        titleSlug: "two-sum",
        markdown: [
            "**Cue:** Look for a complement.",
            "▶ **Start here — no pre-watch** — Attempt before watching.",
            "**Reveal after an honest attempt:** Use a hash map.",
            "🎥 **Concept video** — [Video 1](https://example.com/jit-1)",
            "📖 **Reference** — [Reference](https://example.com/reference)",
            "**Return:** Explain the lookup invariant.",
        ].join("\n\n"),
    }, guide);

    assert.match(result.markdown, /`Direct attempt`.*Start here — no pre-watch/s);
    assert.match(result.markdown, /### M — Core anchor\n\n`M\*`.*Priority guidance: Guidance 1\./s);
    assert.match(result.markdown, /### S — Specialty anchor\n\n`S` 🎬 \*\*takeUforward anchor\*\*/s);
    assert.match(result.markdown, /### C — Complementary\n\n`C`.*Reference/s);
    assert.equal(result.matchedJitVideoUses, 1);
    assert.equal(result.takeUforwardCount, 1);

    const repeated = classifyProblemMarkdown({
        sourceIndex: 1,
        titleSlug: "two-sum",
        markdown: result.markdown,
    }, guide);
    assert.equal(repeated.markdown, result.markdown);
    assert.equal(repeated.classifiedJitArtifacts, result.classifiedJitArtifacts);
});
