const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
    ActivationResources,
    ActivationDisposalError,
    CORE_RESOURCE_KEYS,
    EXTENSION_COMMAND_IDS,
    INTERNAL_COMMAND_IDS,
    initializeDurableMapping,
    ownTreeViews,
    registerCoreActivationResources,
    registerActivationResources,
    registerExtensionResources,
    registerNodeEvent,
    runActivationGuard,
} = require("../../out-test/activation");

test("every injected registration is disposed exactly once in reverse order", () => {
    const calls = [];
    const registrations = Array.from({ length: 12 }, (_, index) => ({
        dispose() { calls.push(index); },
    }));
    const resources = registerActivationResources(() => registrations);

    resources.dispose();
    resources.dispose();

    assert.deepEqual(calls, registrations.map((_item, index) => index).reverse());
});

test("resources added after disposal are disposed immediately once", () => {
    const resources = new ActivationResources();
    resources.dispose();
    let count = 0;

    resources.add({ dispose() { count += 1; } });
    resources.dispose();

    assert.equal(count, 1);
});

test("Node event registration removes the exact listener once", () => {
    const emitter = new EventEmitter();
    let count = 0;
    const listener = () => { count += 1; };
    const registration = registerNodeEvent(emitter, "statusChanged", listener);

    emitter.emit("statusChanged");
    registration.dispose();
    registration.dispose();
    emitter.emit("statusChanged");

    assert.equal(count, 1);
    assert.equal(emitter.listenerCount("statusChanged"), 0);
});

test("the real activation inventory disposes every command, provider, handler, emitter, view, and timer once", () => {
    const disposalCounts = new Map();
    const registrations = [];
    const disposable = (label) => {
        registrations.push(label);
        return {
            dispose() { disposalCounts.set(label, (disposalCounts.get(label) || 0) + 1); },
        };
    };
    const core = Object.fromEntries(CORE_RESOURCE_KEYS.map((key) => [key, disposable(`core:${key}`)]));
    const coreResources = registerCoreActivationResources(core);
    const handlers = Object.fromEntries(EXTENSION_COMMAND_IDS.map((command) => [command, () => command]));
    const registeredHandlers = new Map();
    const extensionResources = registerExtensionResources({
        commandHandlers: handlers,
        registerCommand(command, handler) {
            registeredHandlers.set(command, handler);
            return disposable(`command:${command}`);
        },
        registerStopSession: () => disposable("handler:stop-session"),
        registerFileDecorationProvider: () => disposable("provider:file-decoration"),
        registerWebviewViewProvider: () => disposable("provider:home-webview"),
        registerStatusListener: () => disposable("handler:status-listener"),
        registerUriHandler: () => disposable("handler:uri"),
    });

    coreResources.dispose();
    extensionResources.dispose();
    coreResources.dispose();
    extensionResources.dispose();

    assert.deepEqual([...registeredHandlers.keys()], [...EXTENSION_COMMAND_IDS]);
    for (const command of EXTENSION_COMMAND_IDS) {
        assert.equal(registeredHandlers.get(command), handlers[command]);
    }
    assert.equal(registrations.length, CORE_RESOURCE_KEYS.length + EXTENSION_COMMAND_IDS.length + 5);
    for (const label of registrations) {
        assert.equal(disposalCounts.get(label), 1, `${label} was not disposed exactly once`);
    }
});

test("the executable command inventory matches every contributed command", () => {
    const packageJson = require("../../package.json");
    const contributed = packageJson.contributes.commands.map(({ command }) => command).sort();
    const registered = [
        ...EXTENSION_COMMAND_IDS.filter((command) => !INTERNAL_COMMAND_IDS.includes(command)),
        "leetnotion.stopSession",
    ].sort();

    assert.deepEqual(registered, contributed);
});

test("a failed real registration disposes everything registered before the failure", () => {
    const disposed = [];
    const handlers = Object.fromEntries(EXTENSION_COMMAND_IDS.map((command) => [command, () => undefined]));
    const disposable = (label) => ({ dispose() { disposed.push(label); } });

    assert.throws(() => registerExtensionResources({
        commandHandlers: handlers,
        registerCommand(command) {
            if (command === EXTENSION_COMMAND_IDS[2]) throw new Error("injected registration failure");
            return disposable(command);
        },
        registerStopSession: () => disposable("stop"),
        registerFileDecorationProvider: () => disposable("decoration"),
        registerWebviewViewProvider: () => disposable("webview"),
        registerStatusListener: () => disposable("status"),
        registerUriHandler: () => disposable("uri"),
    }), /injected registration failure/);

    assert.deepEqual(disposed, [
        EXTENSION_COMMAND_IDS[1], EXTENSION_COMMAND_IDS[0], "uri", "status", "webview", "decoration",
    ]);
});

test("durable mapping rejection is handled, stops later initialization, and cleans activation resources", async () => {
    const events = [];
    let timerActive = true;
    let timerDisposeCount = 0;
    const resources = new ActivationResources();
    resources.add({
        dispose() {
            timerActive = false;
            timerDisposeCount += 1;
            events.push("dispose:timer");
        },
    });

    const succeeded = await runActivationGuard(resources, async () => {
        events.push("mapping:start");
        await initializeDurableMapping(async () => {
            throw new Error("mapping write failed");
        });
        events.push("later-initialization");
    }, async (error) => {
        events.push(`handled:${error.message}`);
    });

    assert.equal(succeeded, false);
    assert.equal(timerActive, false);
    assert.equal(timerDisposeCount, 1);
    assert.deepEqual(events, ["mapping:start", "handled:mapping write failed", "dispose:timer"]);
});

test("durable mapping completes before later activation work", async () => {
    const events = [];
    const gate = {};
    gate.promise = new Promise((resolve) => { gate.resolve = resolve; });
    const activation = runActivationGuard({ dispose() {} }, async () => {
        await initializeDurableMapping(async () => {
            events.push("mapping:start");
            await gate.promise;
            events.push("mapping:stored");
        });
        events.push("later-initialization");
    }, () => undefined);

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["mapping:start"]);
    gate.resolve();

    assert.equal(await activation, true);
    assert.deepEqual(events, ["mapping:start", "mapping:stored", "later-initialization"]);
});

test("tree views owned before provider registration are disposed after a partial provider failure", () => {
    const disposed = [];
    const owner = new ActivationResources();
    const disposable = (label) => ({ dispose() { disposed.push(label); } });
    ownTreeViews(owner, [disposable("explorer"), disposable("reviews"), disposable("study")]);
    const handlers = Object.fromEntries(EXTENSION_COMMAND_IDS.map((command) => [command, () => undefined]));

    assert.throws(() => registerExtensionResources({
        commandHandlers: handlers,
        registerCommand: (command) => disposable(command),
        registerStopSession: () => disposable("stop"),
        registerFileDecorationProvider: () => disposable("decoration"),
        registerWebviewViewProvider: () => { throw new Error("provider registration failed"); },
        registerStatusListener: () => disposable("status"),
        registerUriHandler: () => disposable("uri"),
    }), /provider registration failed/);
    owner.dispose();

    assert.deepEqual(disposed, ["decoration", "study", "reviews", "explorer"]);
});

test("throwing disposers do not prevent remaining resources from being cleaned exactly once", () => {
    const calls = [];
    const resources = new ActivationResources();
    resources.add(
        { dispose() { calls.push("first"); throw new Error("first failed"); } },
        { dispose() { calls.push("second"); } },
        { dispose() { calls.push("third"); throw new Error("third failed"); } },
    );

    assert.throws(() => resources.dispose(), (error) => {
        assert.ok(error instanceof ActivationDisposalError);
        assert.equal(error.errors.length, 2);
        return true;
    });
    resources.dispose();

    assert.deepEqual(calls, ["third", "second", "first"]);
});
