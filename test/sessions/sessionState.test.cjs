const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const {
    registerStopSessionCommand,
    SessionState,
    sessionContextKeys,
    stopSessionCommandId,
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

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

test("acquisition rejects a competing session and publishes exclusive context", async () => {
    const { context, state } = createSessionState();

    const studyToken = await state.acquire("study");
    assert.ok(studyToken);
    assert.equal(state.active, "study");
    assert.equal(state.isActive("study"), true);
    assert.equal(state.isActive("review"), false);
    assert.equal(context.get(sessionContextKeys.active), true);
    assert.equal(context.get(sessionContextKeys.study), true);
    assert.equal(context.get(sessionContextKeys.review), false);

    assert.equal(await state.acquire("review"), undefined);
    assert.equal(state.active, "study");

    assert.equal(await state.complete(studyToken), true);
    const reviewToken = await state.acquire("review");
    assert.ok(reviewToken);
    assert.equal(state.active, "review");
    assert.equal(state.isActive("study"), false);
    assert.equal(state.isActive("review"), true);
    assert.equal(context.get(sessionContextKeys.active), true);
    assert.equal(context.get(sessionContextKeys.study), false);
    assert.equal(context.get(sessionContextKeys.review), true);
});

test("stop clears the active session and all context keys", async () => {
    const { context, state } = createSessionState();

    assert.ok(await state.acquire("review"));
    assert.equal(await state.stop(), true);

    assert.equal(state.active, undefined);
    assert.equal(context.get(sessionContextKeys.active), false);
    assert.equal(context.get(sessionContextKeys.study), false);
    assert.equal(context.get(sessionContextKeys.review), false);
    assert.equal(await state.stop(), false);
});

test("completed and cancelled sessions clean up only their exact token", async () => {
    const { state } = createSessionState();

    const reviewToken = await state.acquire("review");
    assert.ok(reviewToken);
    await state.stop();
    const studyToken = await state.acquire("study");
    assert.ok(studyToken);

    assert.equal(await state.complete(reviewToken), false);
    assert.equal(state.active, "study");

    assert.equal(await state.cancel(studyToken), true);
    assert.equal(state.active, undefined);
});

test("continuation routes to the active session only", async () => {
    const { state } = createSessionState();
    const calls = [];
    const continuations = {
        review: async (token) => calls.push(`review:${token.generation}`),
        study: async (token) => calls.push(`study:${token.generation}`),
    };

    assert.equal(await state.continueWith(undefined, continuations), undefined);
    const studyToken = await state.acquire("study");
    assert.ok(studyToken);
    assert.equal(await state.continueWith(studyToken, continuations), "study");
    await state.complete(studyToken);

    const reviewToken = await state.acquire("review");
    assert.ok(reviewToken);
    assert.equal(await state.continueWith(studyToken, continuations), undefined);
    assert.equal(await state.continueWith(reviewToken, continuations), "review");

    assert.deepEqual(calls, [
        `study:${studyToken.generation}`,
        `review:${reviewToken.generation}`,
    ]);
});

test("simultaneous review and study starts have one deterministic winner", async () => {
    const publicationEntered = deferred();
    const publicationGate = deferred();
    let shouldBlock = true;
    const state = new SessionState(async (key, value) => {
        if (shouldBlock && key === sessionContextKeys.active && value) {
            shouldBlock = false;
            publicationEntered.resolve();
            await publicationGate.promise;
        }
    });

    const reviewAcquisition = state.acquire("review");
    await publicationEntered.promise;
    const studyAcquisition = state.acquire("study");

    assert.equal(await studyAcquisition, undefined);
    assert.equal(state.active, "review");
    publicationGate.resolve();
    const reviewToken = await reviewAcquisition;
    assert.ok(reviewToken);
    assert.equal(state.owns(reviewToken), true);
});

test("Stop invalidates a start while context publication is pending", async () => {
    const publicationEntered = deferred();
    const publicationGate = deferred();
    let shouldBlock = true;
    const context = new Map();
    const state = new SessionState(async (key, value) => {
        if (shouldBlock && key === sessionContextKeys.active && value) {
            shouldBlock = false;
            publicationEntered.resolve();
            await publicationGate.promise;
        }
        context.set(key, value);
    });

    const acquisition = state.acquire("study");
    await publicationEntered.promise;
    const stopping = state.stop();
    assert.equal(state.active, undefined);

    publicationGate.resolve();
    assert.equal(await acquisition, undefined);
    assert.equal(await stopping, true);
    assert.equal(context.get(sessionContextKeys.active), false);
    assert.equal(context.get(sessionContextKeys.study), false);
    assert.equal(context.get(sessionContextKeys.review), false);
});

test("initialization and disposal synchronize inactive context", async () => {
    const context = new Map();
    const state = new SessionState();

    await state.initialize(async (key, value) => context.set(key, value));
    assert.equal(context.get(sessionContextKeys.active), false);

    assert.ok(await state.acquire("study"));
    await state.dispose();
    assert.equal(state.active, undefined);
    assert.equal(context.get(sessionContextKeys.active), false);
    assert.equal(context.get(sessionContextKeys.study), false);
});

test("Stop Session contribution is reachable from both session views", () => {
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

});

test("Stop Session registration wires the contributed ID to the real stop handler", async () => {
    const { state } = createSessionState();
    const disposable = { dispose() {} };
    let registered;
    let notificationCount = 0;
    const result = registerStopSessionCommand((command, handler) => {
        registered = { command, handler };
        return disposable;
    }, state, () => {
        notificationCount += 1;
    });

    assert.equal(result, disposable);
    assert.equal(registered.command, stopSessionCommandId);
    assert.equal(registered.command, "leetnotion.stopSession");

    assert.ok(await state.acquire("study"));
    await registered.handler();
    assert.equal(state.active, undefined);
    assert.equal(notificationCount, 1);

    await registered.handler();
    assert.equal(notificationCount, 1);
});

test("extension activation uses the tested Stop Session registrar", () => {
    const extensionPath = path.resolve(__dirname, "../../src/extension.ts");
    const sourceFile = ts.createSourceFile(
        extensionPath,
        readFileSync(extensionPath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const registrarCalls = [];
    function visit(node) {
        if (ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === "registerStopSessionCommand") {
            registrarCalls.push(node);
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    assert.equal(registrarCalls.length, 1);
    assert.equal(registrarCalls[0].arguments.length, 3);
    assert.equal(registrarCalls[0].arguments[1].getText(sourceFile), "sessionState");
    assert.match(registrarCalls[0].arguments[0].getText(sourceFile), /vscode\.commands\.registerCommand/);
});
