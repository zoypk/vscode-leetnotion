const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
    SessionState,
    sessionContextKeys,
} = require("../../out-test/sessions/sessionState");

function createSessionState() {
    const context = new Map();
    const updates = [];
    const state = new SessionState(async (key, value) => {
        updates.push([key, value]);
        context.set(key, value);
    });
    return { context, state, updates };
}

test("starting a session replaces the previous kind and publishes exclusive context", async () => {
    const { context, state } = createSessionState();

    await state.start("study");
    assert.equal(state.active, "study");
    assert.equal(state.isActive("study"), true);
    assert.equal(state.isActive("review"), false);
    assert.equal(context.get(sessionContextKeys.active), true);
    assert.equal(context.get(sessionContextKeys.study), true);
    assert.equal(context.get(sessionContextKeys.review), false);

    await state.start("review");
    assert.equal(state.active, "review");
    assert.equal(state.isActive("study"), false);
    assert.equal(state.isActive("review"), true);
    assert.equal(context.get(sessionContextKeys.active), true);
    assert.equal(context.get(sessionContextKeys.study), false);
    assert.equal(context.get(sessionContextKeys.review), true);
});

test("stop clears the active session and all context keys", async () => {
    const { context, state } = createSessionState();

    await state.start("review");
    assert.equal(await state.stop(), true);

    assert.equal(state.active, undefined);
    assert.equal(context.get(sessionContextKeys.active), false);
    assert.equal(context.get(sessionContextKeys.study), false);
    assert.equal(context.get(sessionContextKeys.review), false);
    assert.equal(await state.stop(), false);
});

test("completed and cancelled sessions clean up only their own active kind", async () => {
    const { state } = createSessionState();

    await state.start("review");
    await state.start("study");
    assert.equal(await state.complete("review"), false);
    assert.equal(state.active, "study");

    assert.equal(await state.cancel("study"), true);
    assert.equal(state.active, undefined);
});

test("continuation routes to the active session only", async () => {
    const { state } = createSessionState();
    const calls = [];
    const continuations = {
        review: async () => calls.push("review"),
        study: async () => calls.push("study"),
    };

    assert.equal(await state.continueWith(continuations), undefined);
    await state.start("study");
    assert.equal(await state.continueWith(continuations), "study");
    await state.start("review");
    assert.equal(await state.continueWith(continuations), "review");

    assert.deepEqual(calls, ["study", "review"]);
});

test("initialization and disposal synchronize inactive context", async () => {
    const context = new Map();
    const state = new SessionState();

    await state.initialize(async (key, value) => context.set(key, value));
    assert.equal(context.get(sessionContextKeys.active), false);

    await state.start("study");
    await state.dispose();
    assert.equal(state.active, undefined);
    assert.equal(context.get(sessionContextKeys.active), false);
    assert.equal(context.get(sessionContextKeys.study), false);
});

test("Stop Session is registered and reachable from both session views", () => {
    const packageJson = require("../../package.json");
    const stopCommand = packageJson.contributes.commands.find(({ command }) => command === "leetnotion.stopSession");
    assert.deepEqual(stopCommand, {
        command: "leetnotion.stopSession",
        title: "Stop Session",
        category: "Leetnotion",
        icon: "$(debug-stop)",
        enablement: "leetnotion.sessionActive",
    });

    const stopMenus = packageJson.contributes.menus["view/title"]
        .filter(({ command }) => command === "leetnotion.stopSession");
    assert.deepEqual(stopMenus.map(({ when }) => when).sort(), [
        "view == leetnotionReviews && leetnotion.sessionActive",
        "view == leetnotionStudy && leetnotion.sessionActive",
    ]);

    const extensionSource = readFileSync(path.resolve(__dirname, "../../src/extension.ts"), "utf8");
    assert.match(extensionSource, /registerCommand\("leetnotion\.stopSession"/);
});
