const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
    ActivationResources,
    registerActivationResources,
    registerNodeEvent,
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

test("activation routes registrations, the URI handler, and recurring cleanup through the resource owner", () => {
    const source = readFileSync(path.resolve(__dirname, "../../src/extension.ts"), "utf8");

    assert.match(source, /registerActivationResources\(\(\) => \[/);
    assert.match(source, /activeResources\.add\(registerNodeEvent\(leetCodeManager/);
    assert.match(source, /activeResources\.add\(vscode\.window\.registerUriHandler/);
    assert.match(source, /dispose: \(\) => \{\s*intervals = clearIntervals\(intervals\)/);
    assert.match(source, /activeResources\?\.dispose\(\)/);
});
