const assert = require("node:assert/strict");
const { mkdtemp, readFile, readdir, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { CacheStore, CACHE_SCHEMA_VERSION } = require("../../out-test/storage/cacheStore");

async function temporaryDirectory() {
    return mkdtemp(path.join(os.tmpdir(), "leetnotion-cache-"));
}

function memento(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        get(key) { return values.get(key); },
        async update(key, value) {
            if (value === undefined) values.delete(key);
            else values.set(key, value);
        },
    };
}

test("migrates a valid legacy cache only after publishing a versioned file", async (t) => {
    const root = await temporaryDirectory();
    t.after(() => rm(root, { recursive: true, force: true }));
    const legacy = memento({ topics: { array: ["1"] } });
    const store = new CacheStore(root, { topics: (value) => value && typeof value === "object" });

    await store.initialize(legacy);

    assert.deepEqual(store.get("topics"), { array: ["1"] });
    assert.equal(legacy.get("topics"), undefined);
    const envelope = JSON.parse(await readFile(store.getFilePath("topics"), "utf8"));
    assert.deepEqual(envelope, {
        version: CACHE_SCHEMA_VERSION,
        key: "topics",
        value: { array: ["1"] },
    });
});

test("a valid file takes precedence and removes a stale Memento copy", async (t) => {
    const root = await temporaryDirectory();
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = new CacheStore(root, { ratings: (value) => value && typeof value === "object" });
    await first.initialize();
    await first.set("ratings", { one: 1200 });
    const legacy = memento({ ratings: { stale: true } });
    const second = new CacheStore(root, { ratings: (value) => value && typeof value === "object" });

    await second.initialize(legacy);

    assert.deepEqual(second.get("ratings"), { one: 1200 });
    assert.equal(legacy.get("ratings"), undefined);
});

test("malformed files do not enter the synchronous snapshot and can fall back to legacy data", async (t) => {
    const root = await temporaryDirectory();
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new CacheStore(root, { lists: Array.isArray });
    await writeFile(store.getFilePath("lists"), "{broken", "utf8");
    const legacy = memento({ lists: [{ slug: "safe" }] });

    await store.initialize(legacy);

    assert.deepEqual(store.get("lists"), [{ slug: "safe" }]);
    assert.equal(legacy.get("lists"), undefined);
});

test("serialized atomic writes leave one complete value and no temporary files", async (t) => {
    const root = await temporaryDirectory();
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new CacheStore(root, { contests: (value) => value && typeof value === "object" });
    await store.initialize();

    await Promise.all(Array.from({ length: 25 }, (_, index) => store.set("contests", { index })));

    assert.deepEqual(store.get("contests"), { index: 24 });
    const envelope = JSON.parse(await readFile(store.getFilePath("contests"), "utf8"));
    assert.deepEqual(envelope.value, { index: 24 });
    assert.deepEqual((await readdir(root)).filter((name) => name.endsWith(".tmp")), []);
});

test("invalid replacement is rejected without changing the published value", async (t) => {
    const root = await temporaryDirectory();
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new CacheStore(root, { lists: Array.isArray });
    await store.initialize();
    await store.set("lists", ["preserved"]);

    await assert.rejects(store.set("lists", { invalid: true }), /invalid value/);

    assert.deepEqual(store.get("lists"), ["preserved"]);
    assert.deepEqual(JSON.parse(await readFile(store.getFilePath("lists"), "utf8")).value, ["preserved"]);
});

test("clear removes both file and synchronous snapshot", async (t) => {
    const root = await temporaryDirectory();
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new CacheStore(root, { lists: Array.isArray });
    await store.initialize();
    await store.set("lists", ["one"]);

    await store.clear();

    assert.equal(store.get("lists"), undefined);
    await assert.rejects(readFile(store.getFilePath("lists")), /ENOENT/);
});
