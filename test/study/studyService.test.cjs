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
    }
    isConfigured() { return true; }
    async read() { return structuredClone(this.state); }
    transaction(mutator) {
        const operation = this.queue.then(async () => {
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
        resolveProblem: (id, existing) => existing ?? { name: `P${id}`, difficulty: "Easy", url: `https://example/${id}`, tags: id === "2" ? ["Graph"] : ["Array"], sheets: id === "3" ? ["NC"] : ["Blind"] },
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

for (const [input, expected] of [[-1, 0], [0, 0], [2.7, 2], [Number.NaN, 0]]) {
    test(`normalizes daily limit ${String(input)} to ${expected}`, async () => {
        const fixture = createFixture({ limit: input });
        await Promise.all([fixture.service.addProblem("1"), fixture.service.addProblem("2"), fixture.service.addProblem("3")]);
        await fixture.service.refresh();
        assert.equal((fixture.storage.state.dailyPlans["2026-08-19"] ?? []).length, expected);
        assert.equal((await fixture.service.getFilterSummary()).newProblemsPerDay, expected);
    });
}
