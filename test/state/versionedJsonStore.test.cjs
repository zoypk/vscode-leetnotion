const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const { mkdtemp, readFile, readdir, stat, unlink, utimes, writeFile } = require("node:fs/promises");
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
    const ownerTokens = [];
    const fixture = await createStore({
        onTempFile: (tempPath) => tempNames.push(path.basename(tempPath)),
        onLockOpened: (_lockPath, ownerToken) => ownerTokens.push(ownerToken),
    });

    await Promise.all(Array.from({ length: 12 }, () => fixture.store.transaction((state) => {
        state.count += 1;
    })));

    assert.equal((await fixture.store.read()).count, 12);
    assert.equal(tempNames.length, 12);
    assert.equal(new Set(tempNames).size, tempNames.length);
    assert.equal(ownerTokens.length, 12);
    assert.equal(new Set(ownerTokens).size, ownerTokens.length);
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
    const staleFixture = await createStore({ isLockOwnerAlive: async () => false });
    const staleLock = `${staleFixture.filePath}.lock`;
    const old = new Date(Date.now() - 1000);
    await writeFile(staleLock, JSON.stringify({
        ownerToken: "stale-dead-owner",
        pid: 9999,
        createdAt: old.toISOString(),
        processStartedAt: new Date(old.getTime() - 1000).toISOString(),
    }));
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

test("never steals an old lock whose recorded process is still alive", async () => {
    const fixture = await createStore({
        isLockOwnerAlive: async (owner) => owner.pid === 4321,
    });
    const lockPath = `${fixture.filePath}.lock`;
    const createdAt = new Date(Date.now() - 2000);
    await writeFile(lockPath, JSON.stringify({
        ownerToken: "live-owner",
        pid: 4321,
        createdAt: createdAt.toISOString(),
        processStartedAt: new Date(createdAt.getTime() - 3600000).toISOString(),
    }));
    const old = new Date(Date.now() - 1000);
    await utimes(lockPath, old, old);

    await assert.rejects(() => fixture.store.transaction((state) => {
        state.count = 1;
    }), /Timed out waiting for state lock/);
    assert.match(await readFile(lockPath, "utf8"), /live-owner/);
    await unlink(lockPath);
});

test("recovers an old lock only after confirming its recorded process is dead", async () => {
    const checkedOwners = [];
    const fixture = await createStore({
        isLockOwnerAlive: async (owner) => {
            checkedOwners.push(owner);
            return false;
        },
    });
    const lockPath = `${fixture.filePath}.lock`;
    const createdAt = new Date(Date.now() - 2000);
    await writeFile(lockPath, JSON.stringify({
        ownerToken: "dead-owner",
        pid: 9876,
        createdAt: createdAt.toISOString(),
        processStartedAt: new Date(createdAt.getTime() - 3600000).toISOString(),
    }));
    const old = new Date(Date.now() - 1000);
    await utimes(lockPath, old, old);

    await fixture.store.transaction((state) => { state.count = 2; });
    assert.equal((await fixture.store.read()).count, 2);
    assert.equal(checkedOwners.length, 1);
    assert.equal(checkedOwners[0].ownerToken, "dead-owner");
    await assert.rejects(() => stat(lockPath), /ENOENT/);
});

test("uses process start metadata to distinguish current-PID reuse", async () => {
    const fixture = await createStore();
    const lockPath = `${fixture.filePath}.lock`;
    const createdAt = new Date(Date.now() - 2000);
    await writeFile(lockPath, JSON.stringify({
        ownerToken: "prior-process-instance",
        pid: process.pid,
        createdAt: createdAt.toISOString(),
        processStartedAt: new Date(createdAt.getTime() - 86400000).toISOString(),
    }));
    const old = new Date(Date.now() - 1000);
    await utimes(lockPath, old, old);

    await fixture.store.transaction((state) => { state.count = 3; });
    assert.equal((await fixture.store.read()).count, 3);
});

test("conservatively preserves a legacy stale lock with a live PID", async () => {
    const fixture = await createStore();
    const lockPath = `${fixture.filePath}.lock`;
    await writeFile(lockPath, JSON.stringify({
        pid: process.pid,
        createdAt: new Date(Date.now() - 2000).toISOString(),
    }));
    const old = new Date(Date.now() - 1000);
    await utimes(lockPath, old, old);

    await assert.rejects(() => fixture.store.transaction((state) => {
        state.count = 4;
    }), /Timed out waiting for state lock/);
    await unlink(lockPath);
});

test("blocks unverifiable external PID reuse with an actionable diagnostic", async () => {
    const fixture = await createStore({ isLockOwnerAlive: async () => "unknown" });
    const lockPath = `${fixture.filePath}.lock`;
    const createdAt = new Date(Date.now() - 2000);
    await writeFile(lockPath, JSON.stringify({
        ownerToken: "unverifiable-owner",
        pid: 2468,
        createdAt: createdAt.toISOString(),
        processStartedAt: new Date(createdAt.getTime() - 1000).toISOString(),
    }));
    await utimes(lockPath, createdAt, createdAt);
    await assert.rejects(() => fixture.store.transaction((state) => {
        state.count = 1;
    }), /Cannot safely verify.*manually remove/i);
    assert.match(await readFile(lockPath, "utf8"), /unverifiable-owner/);
    assert.deepEqual((await readdir(fixture.directory)).sort(), ["state.json.lock"]);
    await unlink(lockPath);
});

test("serializes two waiters racing to recover the same dead lock", async () => {
    const fixture = await createStore();
    const lockPath = `${fixture.filePath}.lock`;
    const createdAt = new Date(Date.now() - 2000);
    await writeFile(lockPath, JSON.stringify({
        ownerToken: "dead-shared-owner",
        pid: 7654,
        createdAt: createdAt.toISOString(),
        processStartedAt: new Date(createdAt.getTime() - 1000).toISOString(),
    }));
    await utimes(lockPath, createdAt, createdAt);

    let announceQuarantine;
    const lockQuarantined = new Promise((resolve) => { announceQuarantine = resolve; });
    let releaseQuarantine;
    const quarantineGate = new Promise((resolve) => { releaseQuarantine = resolve; });
    const commonOptions = {
        filePath: fixture.filePath,
        createEmpty: () => ({ version: 1, count: 0 }),
        parse: parseCounter,
        lockRetryMs: 2,
        lockTimeoutMs: 200,
        staleLockMs: 100,
        isLockOwnerAlive: async () => false,
    };
    const firstStore = new VersionedJsonStore({
        ...commonOptions,
        processQueueKey: "recovery-waiter-a",
        onLockQuarantined: async () => {
            announceQuarantine();
            await quarantineGate;
        },
    });
    const secondStore = new VersionedJsonStore({
        ...commonOptions,
        processQueueKey: "recovery-waiter-b",
    });

    const first = firstStore.transaction((state) => { state.count += 1; });
    await lockQuarantined;
    const second = secondStore.transaction((state) => { state.count += 1; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseQuarantine();
    await Promise.all([first, second]);

    assert.equal((await firstStore.read()).count, 2);
    assert.deepEqual((await readdir(fixture.directory)).sort(), ["state.json"]);
});

test("restores a fresh live replacement encountered between stale check and atomic rename", async () => {
    let replacementInstalled = false;
    const fixture = await createStore({
        isLockOwnerAlive: async () => true,
        onBeforeQuarantineRename: async (lockPath) => {
            if (replacementInstalled) { return; }
            replacementInstalled = true;
            const now = new Date();
            await writeFile(lockPath, JSON.stringify({
                ownerToken: "fresh-replacement",
                pid: 3456,
                createdAt: now.toISOString(),
                processStartedAt: new Date(now.getTime() - 1000).toISOString(),
            }));
            await utimes(lockPath, now, now);
        },
    });
    const lockPath = `${fixture.filePath}.lock`;
    const createdAt = new Date(Date.now() - 2000);
    await writeFile(lockPath, JSON.stringify({
        ownerToken: "original-dead-owner",
        pid: 8765,
        createdAt: createdAt.toISOString(),
        processStartedAt: new Date(createdAt.getTime() - 1000).toISOString(),
    }));
    await utimes(lockPath, createdAt, createdAt);

    await assert.rejects(() => fixture.store.transaction((state) => {
        state.count = 5;
    }), /Timed out waiting for state lock/);
    assert.match(await readFile(lockPath, "utf8"), /fresh-replacement/);
    assert.deepEqual((await readdir(fixture.directory)).sort(), ["state.json.lock"]);
    await unlink(lockPath);
});

test("rereads state after acquiring the lock", async () => {
    const fixture = await createStore();
    let releaseFirst;
    const firstEntered = new Promise((resolve) => {
        releaseFirst = resolve;
    });
    const first = fixture.store.transaction((state) => {
        state.count = 4;
        releaseFirst();
    });
    await firstEntered;
    const second = fixture.store.transaction((state) => { state.count += 3; });
    await Promise.all([first, second]);
    assert.equal((await fixture.store.read()).count, 7);
});

test("rejects asynchronous mutators at runtime without writing", async () => {
    const fixture = await createStore();
    await assert.rejects(() => fixture.store.transaction(async (state) => {
        state.count = 9;
    }), /mutator must be synchronous/);
    assert.deepEqual(await fixture.store.read(), { version: 1, count: 0 });
    assert.deepEqual(await readdir(fixture.directory), []);
});

test("a long transaction aborts if stale recovery replaces its owner token", async () => {
    const fixture = await createStore({ staleLockMs: 1 });
    const lockPath = `${fixture.filePath}.lock`;
    await assert.rejects(() => fixture.store.transaction((state) => {
        state.count = 7;
        const deadline = Date.now() + 5;
        while (Date.now() < deadline) {
            // Deliberately make the lease old enough for another process to recover it.
        }
        writeFileSync(lockPath, JSON.stringify({ ownerToken: "replacement-owner" }));
    }), /Lost ownership of state lock/);

    assert.deepEqual(await fixture.store.read(), { version: 1, count: 0 });
    assert.match(await readFile(lockPath, "utf8"), /replacement-owner/);
    await unlink(lockPath);
});

test("cleans the file handle and owned lock when setup fails after exclusive open", async () => {
    let opened = 0;
    const fixture = await createStore({
        onLockOpened: () => {
            opened += 1;
            throw new Error("post-open setup failed");
        },
    });

    await assert.rejects(() => fixture.store.transaction((state) => {
        state.count = 1;
    }), /post-open setup failed/);
    assert.equal(opened, 1);
    assert.deepEqual(await readdir(fixture.directory), []);
});

test("closes the handle and removes the exclusive lock when handle.stat fails", async () => {
    const fixture = await createStore({
        statLockHandle: async () => { throw new Error("injected stat failure"); },
    });
    await assert.rejects(() => fixture.store.transaction((state) => {
        state.count = 1;
    }), /injected stat failure/);
    assert.deepEqual(await readdir(fixture.directory), []);
});
