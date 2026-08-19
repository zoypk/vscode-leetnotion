const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

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
const { StudyService } = require("../../out-test/study/studyService");
Module._load = originalLoad;

class MemoryStorage {
    constructor() {
        this.state = { version: 1, backlog: {}, dailyPlans: {} };
        this.queue = Promise.resolve();
        this.writes = 0;
        this.blocker = undefined;
    }
    isConfigured() { return true; }
    async read() { return structuredClone(this.state); }
    transaction(mutator) {
        const operation = this.queue.then(async () => {
            if (this.blocker) { await this.blocker; }
            const next = structuredClone(this.state);
            const before = JSON.stringify(next);
            const result = await mutator(next);
            if (JSON.stringify(next) !== before) {
                this.state = next;
                this.writes += 1;
            }
            return result;
        });
        this.queue = operation.then(() => undefined, () => undefined);
        return operation;
    }
    pauseTransactions() {
        let release;
        this.blocker = new Promise((resolve) => { release = resolve; });
        return () => {
            this.blocker = undefined;
            release();
        };
    }
}

function createFixture(overrides = {}) {
    const storage = new MemoryStorage();
    const settings = { sheetFilters: [], topicFilters: [], limit: 2, weekdaysOnly: false, ...overrides };
    const service = new StudyService({
        storage,
        clock: () => new Date("2026-08-19T10:00:00.000Z"),
        getDueReviews: async () => [],
        activeSheetFilters: () => settings.sheetFilters,
        activeTopicFilters: () => settings.topicFilters,
        newProblemsPerDay: () => settings.limit,
        weekdaysOnly: () => settings.weekdaysOnly,
        resolveProblem: (id, existing) => existing ?? { name: `P${id}`, difficulty: "Easy", url: `https://example/${id}`, tags: id === "2" ? ["Graph"] : ["Array"], sheets: id === "3" ? ["NC"] : ["Blind"], companies: [] },
    });
    return { service, settings, storage };
}

test("refresh writes one deterministic plan while all read methods perform zero writes", async () => {
    const fixture = createFixture();
    await Promise.all([fixture.service.addProblem("1"), fixture.service.addProblem("2"), fixture.service.addProblem("3")]);
    const beforeRefresh = fixture.storage.writes;
    const sections = await fixture.service.refresh();
    assert.equal(fixture.storage.writes, beforeRefresh + 1);
    assert.deepEqual(fixture.storage.state.dailyPlans["2026-08-19"], ["1", "2"]);
    const afterRefresh = fixture.storage.writes;
    await fixture.service.getTodayItems();
    await fixture.service.getBacklogItems();
    await fixture.service.getFilterSummary();
    assert.equal(fixture.storage.writes, afterRefresh);
    assert.equal(sections[0].items.length, 2);
});

test("refresh reapplies filters to existing items and refills deterministically", async () => {
    const fixture = createFixture();
    await fixture.service.addProblem("1");
    await fixture.service.addProblem("2");
    await fixture.service.addProblem("3");
    await fixture.service.refresh();
    fixture.settings.topicFilters = ["Array"];
    await fixture.service.refresh();
    assert.deepEqual(fixture.storage.state.dailyPlans["2026-08-19"], ["1", "3"]);
});

test("refresh re-resolves changed snapshot membership before materializing the plan", async () => {
    const storage = new MemoryStorage();
    let now = new Date("2026-08-19T10:00:00.000Z");
    let currentSnapshot = {
        name: "Old name",
        difficulty: "Easy",
        url: "https://example/42",
        tags: ["Array"],
        sheets: ["Blind"],
        companies: ["Old Company"],
    };
    const service = new StudyService({
        storage,
        clock: () => now,
        getDueReviews: async () => [],
        activeSheetFilters: () => ["NC"],
        activeTopicFilters: () => ["Graph"],
        newProblemsPerDay: () => 1,
        weekdaysOnly: () => false,
        resolveProblem: () => structuredClone(currentSnapshot),
    });

    await service.addProblem("42");
    const original = structuredClone(storage.state.backlog["42"]);
    storage.state.backlog["42"].deferredUntil = "2026-08-19";
    currentSnapshot = {
        name: "Updated name",
        difficulty: "Medium",
        url: "https://example/updated-42",
        tags: ["Graph"],
        sheets: ["NC"],
        companies: ["Current Company"],
    };
    now = new Date("2026-08-20T10:00:00.000Z");

    await service.refresh();

    assert.deepEqual(storage.state.dailyPlans["2026-08-20"], ["42"]);
    assert.deepEqual(storage.state.backlog["42"].problem, currentSnapshot);
    assert.equal(storage.state.backlog["42"].addedAt, original.addedAt);
    assert.equal(storage.state.backlog["42"].deferredUntil, "2026-08-19");
    assert.equal(storage.state.backlog["42"].updatedAt, "2026-08-20T10:00:00.000Z");
    const backlogSection = (await service.getSections()).find((section) => section.id === "backlog");
    assert.deepEqual(backlogSection.items[0].companies, ["Current Company"]);
});

test("default resolver removes stale sheets and refreshes URL, tags, and companies from current metadata", async () => {
    const storage = new MemoryStorage();
    let now = new Date("2026-08-19T10:00:00.000Z");
    let problem = { name: "Old name", difficulty: "Easy", tags: ["Array"], companies: ["Old Company"] };
    let sheets = { "Legacy Sheet": ["42"] };
    let titleSlugMapping = { "old-title": "42" };
    const service = new StudyService({
        storage,
        clock: () => now,
        getDueReviews: async () => [],
        activeSheetFilters: () => [],
        activeTopicFilters: () => [],
        newProblemsPerDay: () => 1,
        weekdaysOnly: () => false,
    });
    const originalLoadForResolver = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "../explorer/explorerNodeManager") {
            return { explorerNodeManager: { getNodeById: () => problem } };
        }
        if (request === "../utils/dataUtils") {
            return { getSheets: () => sheets, extractArrayElements: (sheet) => sheet };
        }
        if (request === "../globalState") {
            return { globalState: { getTitleSlugQuestionNumberMapping: () => titleSlugMapping } };
        }
        if (request === "../shared") {
            return { getUrl: () => "https://leetcode.com" };
        }
        return originalLoadForResolver.call(this, request, parent, isMain);
    };

    try {
        await service.addProblem("42");
        assert.deepEqual(storage.state.backlog["42"].problem, {
            name: "Old name",
            difficulty: "Easy",
            url: "https://leetcode.com/problems/old-title",
            tags: ["Array"],
            sheets: ["Legacy Sheet"],
            companies: ["Old Company"],
        });

        problem = { name: "Current name", difficulty: "Medium", tags: ["Graph"], companies: ["Current Company"] };
        sheets = {};
        titleSlugMapping = { "current-title": "42" };
        now = new Date("2026-08-20T10:00:00.000Z");
        const sections = await service.refresh();

        assert.deepEqual(storage.state.backlog["42"].problem, {
            name: "Current name",
            difficulty: "Medium",
            url: "https://leetcode.com/problems/current-title",
            tags: ["Graph"],
            sheets: [],
            companies: ["Current Company"],
        });
        const backlogItem = sections.find((section) => section.id === "backlog").items[0];
        assert.deepEqual(backlogItem.companies, ["Current Company"]);

        titleSlugMapping = {};
        await service.refresh();
        assert.equal(storage.state.backlog["42"].problem.url, "https://leetcode.com/problems/current-title");
    } finally {
        Module._load = originalLoadForResolver;
    }
});

test("refresh does not write or change updatedAt when every resolved snapshot and plan are unchanged", async () => {
    const fixture = createFixture();
    await fixture.service.addProblem("1");
    await fixture.service.refresh();
    const writes = fixture.storage.writes;
    const updatedAt = fixture.storage.state.backlog["1"].updatedAt;

    await fixture.service.refresh();

    assert.equal(fixture.storage.writes, writes);
    assert.equal(fixture.storage.state.backlog["1"].updatedAt, updatedAt);
});

test("deferrals and removals purge planned entries", async () => {
    const fixture = createFixture();
    await fixture.service.addProblem("1");
    await fixture.service.addProblem("2");
    await fixture.service.refresh();
    await fixture.service.deferProblemUntilTomorrow("1");
    await fixture.service.removeProblem("2");
    await fixture.service.refresh();
    assert.deepEqual(fixture.storage.state.dailyPlans["2026-08-19"] ?? [], []);
});

test("parallel backlog additions retain every record", async () => {
    const fixture = createFixture();
    await Promise.all(Array.from({ length: 8 }, (_, index) => fixture.service.addProblem(String(index + 1))));
    assert.equal(Object.keys(fixture.storage.state.backlog).length, 8);
});

test("overlapping backlog addition and deferral retain both updates", async () => {
    const fixture = createFixture();
    await fixture.service.addProblem("1");
    const release = fixture.storage.pauseTransactions();
    const deferral = fixture.service.deferProblemUntilTomorrow("1");
    const addition = fixture.service.addProblem("2");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.storage.state.backlog["2"], undefined);
    release();
    await Promise.all([deferral, addition]);
    assert.equal(fixture.storage.state.backlog["1"].deferredUntil, "2026-08-20");
    assert.equal(fixture.storage.state.backlog["2"].questionNumber, "2");
});

for (const [input, expected] of [[-1, 0], [0, 0], [2.7, 2], [Number.NaN, 0]]) {
    test(`normalizes daily limit ${String(input)} to ${expected}`, async () => {
        const fixture = createFixture({ limit: input });
        await Promise.all([fixture.service.addProblem("1"), fixture.service.addProblem("2"), fixture.service.addProblem("3")]);
        await fixture.service.refresh();
        assert.equal((fixture.storage.state.dailyPlans["2026-08-19"] ?? []).length, expected);
        assert.equal((await fixture.service.getFilterSummary()).newProblemsPerDay, expected);
    });
}
