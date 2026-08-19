const assert = require("node:assert/strict");
const test = require("node:test");

const { RefreshCoordinator } = require("../../out-test/explorer/refreshCoordinator.js");

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

test("keeps the last good snapshot visible and discards an older generation", async () => {
    const builds = [];
    const installed = [];
    let visibleSnapshot = new Map([["last-good", { id: "last-good" }]]);

    const coordinator = new RefreshCoordinator({
        buildSnapshot: (generation) => {
            const build = deferred();
            builds.push({ build, generation });
            return build.promise;
        },
        installSnapshot: (snapshot, generation) => {
            visibleSnapshot = snapshot;
            installed.push(generation);
        },
    });

    const statusRefresh = coordinator.requestRefresh();
    await Promise.resolve();
    assert.deepEqual(builds.map(({ generation }) => generation), [1]);

    const timerRefresh = coordinator.requestRefresh();
    const manualRefresh = coordinator.requestRefresh();
    const submitRefresh = coordinator.requestRefresh();

    builds[0].build.resolve(new Map([["stale", { id: "stale" }]]));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(visibleSnapshot.has("last-good"), true);
    assert.equal(visibleSnapshot.size, 1);
    assert.deepEqual(installed, []);
    assert.deepEqual(builds.map(({ generation }) => generation), [1, 4]);

    builds[1].build.resolve(new Map([["fresh", { id: "fresh" }]]));
    await Promise.all([statusRefresh, timerRefresh, manualRefresh, submitRefresh]);

    assert.equal(visibleSnapshot.has("fresh"), true);
    assert.equal(visibleSnapshot.size, 1);
    assert.deepEqual(installed, [4]);
});

test("coalesces refreshes requested during a build and installs one snapshot event", async () => {
    const builds = [];
    const installed = [];
    const coordinator = new RefreshCoordinator({
        buildSnapshot: (generation) => {
            const build = deferred();
            builds.push({ build, generation });
            return build.promise;
        },
        installSnapshot: (_snapshot, generation) => installed.push(generation),
    });

    const first = coordinator.requestRefresh();
    await Promise.resolve();
    const overlaps = Array.from({ length: 8 }, () => coordinator.requestRefresh());

    builds[0].build.resolve({ value: "outdated" });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(builds.map(({ generation }) => generation), [1, 9]);

    builds[1].build.resolve({ value: "latest" });
    await Promise.all([first, ...overlaps]);

    assert.deepEqual(installed, [9]);
});

test("reports a failed refresh once, preserves the last good snapshot, and can recover", async () => {
    let visibleSnapshot = { value: "last-good" };
    const errors = [];
    let shouldFail = true;
    const coordinator = new RefreshCoordinator({
        buildSnapshot: async () => {
            if (shouldFail) {
                throw new Error("network unavailable");
            }
            return { value: "recovered" };
        },
        installSnapshot: (snapshot) => {
            visibleSnapshot = snapshot;
        },
        reportError: (error) => errors.push(error),
    });

    await coordinator.requestRefresh();
    assert.deepEqual(visibleSnapshot, { value: "last-good" });
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /network unavailable/);

    shouldFail = false;
    await coordinator.requestRefresh();
    assert.deepEqual(visibleSnapshot, { value: "recovered" });
    assert.equal(errors.length, 1);
});

test("does not lose a request queued at the completion boundary", async () => {
    const builtGenerations = [];
    const installedGenerations = [];
    let boundaryRefresh;
    let coordinator;

    coordinator = new RefreshCoordinator({
        buildSnapshot: async (generation) => {
            builtGenerations.push(generation);
            return { generation };
        },
        installSnapshot: (_snapshot, generation) => {
            installedGenerations.push(generation);
            if (generation === 1) {
                queueMicrotask(() => {
                    boundaryRefresh = coordinator.requestRefresh();
                });
            }
        },
    });

    await coordinator.requestRefresh();
    assert.ok(boundaryRefresh);
    await boundaryRefresh;

    assert.deepEqual(builtGenerations, [1, 2]);
    assert.deepEqual(installedGenerations, [1, 2]);
});

test("dispose invalidates an in-flight generation and prevents future builds", async () => {
    const build = deferred();
    let buildCount = 0;
    let visibleSnapshot = { value: "last-good" };
    let installCount = 0;
    const errors = [];
    const coordinator = new RefreshCoordinator({
        buildSnapshot: () => {
            buildCount += 1;
            return build.promise;
        },
        installSnapshot: (snapshot) => {
            installCount += 1;
            visibleSnapshot = snapshot;
        },
        reportError: (error) => errors.push(error),
    });

    const refresh = coordinator.requestRefresh();
    await Promise.resolve();
    coordinator.dispose();
    build.resolve({ value: "must-not-publish" });
    await refresh;

    assert.deepEqual(visibleSnapshot, { value: "last-good" });
    assert.equal(installCount, 0);
    assert.equal(errors.length, 0);

    await coordinator.requestRefresh();
    assert.equal(buildCount, 1);
});
