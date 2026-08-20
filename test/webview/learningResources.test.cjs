const assert = require("node:assert/strict");
const test = require("node:test");

const { parseLearningResources } = require("../../out-test/webview/learningResources.js");

test("separates attempt, reveal, classified artifacts, and return checkpoint", () => {
    const parsed = parseLearningResources([
        "**Cue:** Look for a complement.",
        "`Direct attempt` ▶ **Start here — no pre-watch** — Solve first.",
        "**Reveal after an honest attempt:** Maintain seen values.",
        "### M — Core anchor",
        "`M` 🧱 **Core concept / correctness** — [Hashing](https://example.com/hash)",
        "### R — Rescue only",
        "`R` 🛟 **Rescue only** — [Walkthrough](https://example.com/rescue)",
        "**Return:** Explain why one pass is enough.",
    ].join("\n\n"));

    assert.match(parsed.attemptMarkdown, /Look for a complement/);
    assert.match(parsed.attemptMarkdown, /Direct attempt/);
    assert.equal(parsed.revealMarkdown, "Maintain seen values.");
    assert.deepEqual(parsed.groups.map(({ priority, title }) => ({ priority, title })), [
        { priority: "M", title: "Core anchor" },
        { priority: "R", title: "Rescue only" },
    ]);
    assert.equal(parsed.returnMarkdown, "Explain why one pass is enough.");
});

test("keeps legacy unclassified resources available as complementary material", () => {
    const parsed = parseLearningResources([
        "**Cue:** Try a smaller input.",
        "**Reveal after an honest attempt:** Use two pointers.",
        "📖 **Reference** — [Guide](https://example.com/guide)",
        "**Return:** State the invariant.",
    ].join("\n\n"));

    assert.equal(parsed.groups.length, 1);
    assert.equal(parsed.groups[0].priority, "C");
    assert.equal(parsed.groups[0].title, "Additional resources");
    assert.match(parsed.groups[0].markdown, /Reference/);
});
