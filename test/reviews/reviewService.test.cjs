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
const { ReviewService } = require("../../out-test/reviews/reviewService");
Module._load = originalLoad;

class MemoryStorage {
    constructor() {
        this.state = { version: 1, reviews: {} };
        this.queue = Promise.resolve();
    }
    isConfigured() { return true; }
    async read() { return structuredClone(this.state); }
    transaction(mutator) {
        const operation = this.queue.then(async () => {
            const next = structuredClone(this.state);
            const result = await mutator(next);
            this.state = next;
            return result;
        });
        this.queue = operation.then(() => undefined, () => undefined);
        return operation;
    }
}

function createFixture() {
    const storage = new MemoryStorage();
    let ratings = 0;
    const scheduler = {
        repeat: () => ({ 1: { card: { due: new Date("2026-08-20T00:00:00.000Z") } }, 2: { card: { due: new Date("2026-08-21T00:00:00.000Z") } }, 3: { card: { due: new Date("2026-08-22T00:00:00.000Z") } }, 4: { card: { due: new Date("2026-08-23T00:00:00.000Z") } } }),
        next: (card, now) => {
            ratings += 1;
            return { card: { ...card, due: new Date(now.getTime() + 60000), reps: card.reps + 1, last_review: now } };
        },
        get_retrievability: () => 0.9,
    };
    const emptyCard = (now) => ({ due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0 });
    const service = new ReviewService({
        storage,
        clock: () => new Date("2026-08-19T10:00:00.000Z"),
        scheduler,
        createEmptyCard: emptyCard,
        resolveProblem: (id, snapshot, existing) => ({ name: snapshot?.name ?? existing?.name ?? `P${id}`, difficulty: snapshot?.difficulty ?? existing?.difficulty ?? "Easy", url: snapshot?.url ?? existing?.url ?? `https://example/${id}` }),
        activeFilters: () => [],
    });
    return { service, storage, getRatings: () => ratings };
}

test("serializes parallel ratings without losing either update", async () => {
    const fixture = createFixture();
    await fixture.service.ensureInitiallyScheduled("1");
    await Promise.all([
        fixture.service.applyRating("1", "good"),
        fixture.service.applyRating("1", "easy"),
    ]);
    assert.equal(fixture.storage.state.reviews["1"].fsrsCard.reps, 2);
    assert.equal(fixture.getRatings(), 2);
});

test("addAndApplyRating creates and rates exactly once", async () => {
    const fixture = createFixture();
    await fixture.service.addAndApplyRating("2", "good", { name: "Two" });
    assert.equal(fixture.storage.state.reviews["2"].fsrsCard.reps, 1);
    assert.equal(fixture.getRatings(), 1);
});

test("unrelated snapshot updates and idempotent initial scheduling never re-rate or reschedule", async () => {
    const fixture = createFixture();
    await fixture.service.ensureInitiallyScheduled("3", { name: "First" }, "good");
    const initialDue = fixture.storage.state.reviews["3"].fsrsCard.due;
    await fixture.service.addProblem("3", { name: "Updated" });
    await fixture.service.ensureInitiallyScheduled("3", { difficulty: "Hard" }, "easy");
    assert.equal(fixture.getRatings(), 1);
    assert.equal(fixture.storage.state.reviews["3"].fsrsCard.due, initialDue);
    assert.equal(fixture.storage.state.reviews["3"].problem.name, "Updated");
});

test("parallel schedule and removal operations are serialized", async () => {
    const fixture = createFixture();
    await fixture.service.ensureInitiallyScheduled("4");
    await fixture.service.scheduleAt("4", new Date("2026-09-01T00:00:00.000Z"));
    assert.equal(fixture.storage.state.reviews["4"].fsrsCard.due, "2026-09-01T00:00:00.000Z");
    await fixture.service.removeProblem("4");
    assert.equal(fixture.storage.state.reviews["4"], undefined);
});
