const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const sessionModulePath = require.resolve("../../out-test/study/session");

function loadStudyServiceClass() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "vscode") {
            return {
                env: { appName: "Visual Studio Code" },
                window: { createOutputChannel: () => ({ append: () => undefined, appendLine: () => undefined, clear: () => undefined, show: () => undefined }) },
                workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require("../../out-test/study/studyService").StudyService;
    } finally {
        Module._load = originalLoad;
    }
}

const StudyService = loadStudyServiceClass();

class MemoryStorage {
    constructor() {
        this.state = { version: 1, backlog: {}, dailyPlans: {} };
        this.reads = 0;
        this.transactions = 0;
    }
    isConfigured() { return true; }
    async read() {
        this.reads += 1;
        return structuredClone(this.state);
    }
    async transaction(mutator) {
        this.transactions += 1;
        const next = structuredClone(this.state);
        const result = mutator(next);
        this.state = next;
        return result;
    }
}

function backlogItem(questionNumber) {
    return {
        kind: "new",
        id: `study-backlog-${questionNumber}`,
        questionNumber,
        name: `Problem ${questionNumber}`,
        difficulty: "Easy",
        url: `https://example/${questionNumber}`,
        tags: [],
        sheets: [],
        addedAt: "2026-08-18T10:00:00.000Z",
        plannedForToday: true,
        matchesActiveFilters: true,
    };
}

function sectionsWithToday(items) {
    return [
        { id: "today", label: "Today", description: `${items.length}`, emptyLabel: "Empty", items },
        { id: "backlog", label: "Backlog", description: "0", emptyLabel: "Empty", items: [] },
        { id: "filters", label: "Filters", description: "All", emptyLabel: "Empty", items: [] },
    ];
}

function loadSession(studyService) {
    const opened = [];
    const messages = [];
    const originalLoad = Module._load;
    delete require.cache[sessionModulePath];
    Module._load = function(request, parent, isMain) {
        if (request === "vscode") {
            return { window: { showInformationMessage: (message) => { messages.push(message); } } };
        }
        if (request === "../commands/show") {
            return {
                openProblem: async (problem) => { opened.push(problem); },
                previewProblem: async () => undefined,
            };
        }
        if (request === "../explorer/explorerNodeManager") {
            return { explorerNodeManager: { getNodeById: (id) => ({ id }) } };
        }
        if (request === "../shared") {
            return { defaultProblem: {} };
        }
        if (request === "./studyService") {
            return { studyService };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return { session: require(sessionModulePath), opened, messages };
    } finally {
        Module._load = originalLoad;
    }
}

test("cold command-palette start materializes today's plan before selecting", async () => {
    let refreshes = 0;
    const fixture = loadSession({
        refresh: async () => {
            refreshes += 1;
            return sectionsWithToday([backlogItem("101")]);
        },
    });

    await fixture.session.startStudySession();

    assert.equal(refreshes, 1);
    assert.deepEqual(fixture.opened, [{ id: "101" }]);
    assert.deepEqual(fixture.messages, []);
});

test("date-rollover start materializes today with real storage and selects from that single refresh", async () => {
    const storage = new MemoryStorage();
    let now = new Date(2026, 7, 19, 23, 59);
    const service = new StudyService({
        storage,
        clock: () => now,
        getDueReviews: async () => [],
        activeSheetFilters: () => [],
        activeTopicFilters: () => [],
        newProblemsPerDay: () => 1,
        weekdaysOnly: () => false,
        resolveProblem: (id) => ({
            name: `P${id}`,
            difficulty: "Easy",
            url: `https://example/${id}`,
            tags: [],
            sheets: [],
            companies: [],
        }),
    });

    await service.addProblem("101");
    await service.refresh();
    assert.deepEqual(storage.state.dailyPlans["2026-08-19"], ["101"]);
    await service.removeProblem("101");
    await service.addProblem("202");

    now = new Date(2026, 7, 20, 0, 1);
    storage.reads = 0;
    storage.transactions = 0;
    const fixture = loadSession(service);

    await fixture.session.startStudySession();

    assert.deepEqual(storage.state.dailyPlans["2026-08-20"], ["202"]);
    assert.equal(storage.transactions, 1);
    assert.equal(storage.reads, 0);
    assert.deepEqual(fixture.opened, [{ id: "202" }]);
});
