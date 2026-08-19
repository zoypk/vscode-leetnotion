const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const providerModulePath = require.resolve("../../out-test/study/studyTreeDataProvider");

test("backlog item tooltip labels current company metadata", async () => {
    const backlogItem = {
        kind: "new",
        id: "study-backlog-42",
        questionNumber: "42",
        name: "Problem 42",
        difficulty: "Medium",
        url: "https://example/42",
        tags: ["Graph"],
        sheets: [],
        companies: ["Current Company", "Second Company"],
        addedAt: "2026-08-19T10:00:00.000Z",
        plannedForToday: true,
        matchesActiveFilters: true,
    };
    const sections = [
        { id: "today", label: "Today", description: "1", emptyLabel: "Empty", items: [backlogItem] },
        { id: "backlog", label: "Backlog", description: "1", emptyLabel: "Empty", items: [backlogItem] },
        { id: "filters", label: "Filters", description: "All", emptyLabel: "Empty", items: [] },
    ];
    class EventEmitter {
        constructor() { this.event = () => undefined; }
        fire() {}
    }
    class TreeItem {
        constructor(label, collapsibleState) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    }
    const originalLoad = Module._load;
    delete require.cache[providerModulePath];
    Module._load = function(request, parent, isMain) {
        if (request === "vscode") {
            return {
                EventEmitter,
                TreeItem,
                ThemeIcon: class ThemeIcon {},
                TreeItemCollapsibleState: { None: 0, Expanded: 2 },
            };
        }
        if (request === "./studyService") {
            return { studyService: { isConfigured: () => true, refresh: async () => sections } };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let StudyTreeDataProvider;
    try {
        StudyTreeDataProvider = require(providerModulePath).StudyTreeDataProvider;
    } finally {
        Module._load = originalLoad;
    }
    const provider = new StudyTreeDataProvider();
    await provider.refresh();
    const roots = await provider.getChildren();
    const today = roots.find((node) => node.sectionId === "today");
    const [node] = await provider.getChildren(today);

    assert.match(node.tooltip, /Companies: Current Company, Second Company/);
});
