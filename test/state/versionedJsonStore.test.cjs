const assert = require("node:assert/strict");
const { mkdtemp, readFile, readdir, stat, utimes, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { VersionedJsonStore } = require("../../out-test/state/versionedJsonStore");

function parseCounter(value, sourcePath) {
    if (!value || value.version !== 1 || !Number.isInteger(value.count)) {
        throw new Error(`${sourcePath}.count must be an integer in version 1 state`);
    }
    return { version: 1, count: value.count };
}

async function createStore(options = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "leetnotion-store-"));
    const filePath = path.join(directory, "state.json");
    return {
        directory,
        filePath,
        store: new VersionedJsonStore({
            filePath,
            createEmpty: () => ({ version: 1, count: 0 }),
            parse: parseCounter,
            lockRetryMs: 5,
            lockTimeoutMs: 40,
            staleLockMs: 100,
            ...options,
        }),
    };
}

test("serializes concurrent mutations without losing updates and uses unique temp files", async () => {
    const tempNames = [];
    const fixture = await createStore({ onTempFile: (tempPath) => tempNames.push(path.basename(tempPath)) });

    await Promise.all(Array.from({ length: 12 }, () => fixture.store.transaction(async (state) => {
        const before = state.count;
        await new Promise((resolve) => setTimeout(resolve, 2));
        state.count = before + 1;
    })));

    assert.equal((await fixture.store.read()).count, 12);
    assert.equal(tempNames.length, 12);
    assert.equal(new Set(tempNames).size, tempNames.length);
    assert.deepEqual((await readdir(fixture.directory)).sort(), ["state.json"]);
});

test("does not create files for a read-only read of missing state", async () => {
    const fixture = await createStore();
    assert.deepEqual(await fixture.store.read(), { version: 1, count: 0 });
    assert.deepEqual(await readdir(fixture.directory), []);
});

test("rejects malformed and unsupported state with the source path", async () => {
    const fixture = await createStore();
    await writeFile(fixture.filePath, JSON.stringify({ version: 2, count: "bad" }));
    await assert.rejects(() => fixture.store.read(), /state\.json\.count must be an integer in version 1 state/);
});

test("leaves the original state intact and cleans artifacts when a mutator fails", async () => {
    const fixture = await createStore();
    await fixture.store.transaction((state) => { state.count = 3; });

    await assert.rejects(() => fixture.store.transaction((state) => {
        state.count = 99;
        throw new Error("mutator failed");
    }), /mutator failed/);

    assert.equal(JSON.parse(await readFile(fixture.filePath, "utf8")).count, 3);
    assert.deepEqual((await readdir(fixture.directory)).sort(), ["state.json"]);
});

test("recovers a stale lock but preserves and times out on a fresh lock", async () => {
    const staleFixture = await createStore();
    const staleLock = `${staleFixture.filePath}.lock`;
    await writeFile(staleLock, "stale");
    const old = new Date(Date.now() - 1000);
    await utimes(staleLock, old, old);
    await staleFixture.store.transaction((state) => { state.count += 1; });
    assert.equal((await staleFixture.store.read()).count, 1);
    await assert.rejects(() => stat(staleLock), /ENOENT/);

    const freshFixture = await createStore();
    const freshLock = `${freshFixture.filePath}.lock`;
    await writeFile(freshLock, "fresh");
    await assert.rejects(() => freshFixture.store.transaction((state) => {
        state.count += 1;
    }), /Timed out waiting for state lock/);
    assert.equal(await readFile(freshLock, "utf8"), "fresh");
});

test("rereads state after acquiring the lock", async () => {
    const fixture = await createStore();
    let releaseFirst;
    const firstEntered = new Promise((resolve) => {
        releaseFirst = resolve;
    });
    let allowFirstToFinish;
    const gate = new Promise((resolve) => {
        allowFirstToFinish = resolve;
    });

    const first = fixture.store.transaction(async (state) => {
        state.count = 4;
        releaseFirst();
        await gate;
    });
    await firstEntered;
    const second = fixture.store.transaction((state) => { state.count += 3; });
    allowFirstToFinish();
    await Promise.all([first, second]);
    assert.equal((await fixture.store.read()).count, 7);
});
