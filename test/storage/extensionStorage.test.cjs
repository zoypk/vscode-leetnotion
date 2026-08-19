const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
    CACHE_VALIDATORS,
    COOKIE_SECRET_KEY,
    ExtensionStorage,
    LARGE_CACHE_KEYS,
    MAX_MEMENTO_VALUE_BYTES,
    MEMENTO_SMALL_VALUE_KEYS,
    NOTION_TOKEN_SECRET_KEY,
} = require("../../out-test/storage/extensionStorage");
const { CacheStore, CACHE_SCHEMA_VERSION } = require("../../out-test/storage/cacheStore");

async function context(initialMemento = {}, initialSecrets = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), "leetnotion-storage-"));
    const mementoValues = new Map(Object.entries(initialMemento));
    const secretValues = new Map(Object.entries(initialSecrets));
    const updates = [];
    return {
        root,
        updates,
        globalStorageUri: { fsPath: root },
        globalState: {
            keys: () => [...mementoValues.keys()],
            get: (key) => mementoValues.get(key),
            async update(key, value) {
                updates.push([key, value]);
                if (value === undefined) mementoValues.delete(key);
                else mementoValues.set(key, value);
            },
            values: mementoValues,
        },
        secrets: {
            get: async (key) => secretValues.get(key),
            async store(key, value) { secretValues.set(key, value); },
            async delete(key) { secretValues.delete(key); },
            values: secretValues,
        },
    };
}

test("migrates both credentials, verifies them, and leaves no Memento secret", async (t) => {
    const fake = await context({
        [COOKIE_SECRET_KEY]: "cookie-value",
        [NOTION_TOKEN_SECRET_KEY]: "notion-value",
    });
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const storage = new ExtensionStorage();

    await storage.initialize(fake);

    assert.equal(storage.get(COOKIE_SECRET_KEY), "cookie-value");
    assert.equal(storage.get(NOTION_TOKEN_SECRET_KEY), "notion-value");
    assert.equal(fake.secrets.values.get(COOKIE_SECRET_KEY), "cookie-value");
    assert.equal(fake.secrets.values.get(NOTION_TOKEN_SECRET_KEY), "notion-value");
    assert.equal(fake.globalState.values.has(COOKIE_SECRET_KEY), false);
    assert.equal(fake.globalState.values.has(NOTION_TOKEN_SECRET_KEY), false);
});

test("existing SecretStorage wins over stale legacy values and migration is idempotent", async (t) => {
    const fake = await context({ [COOKIE_SECRET_KEY]: "legacy" }, { [COOKIE_SECRET_KEY]: "secret" });
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const first = new ExtensionStorage();
    await first.initialize(fake);
    const second = new ExtensionStorage();
    await second.initialize(fake);

    assert.equal(first.get(COOKIE_SECRET_KEY), "secret");
    assert.equal(second.get(COOKIE_SECRET_KEY), "secret");
    assert.equal(fake.globalState.values.has(COOKIE_SECRET_KEY), false);
});

test("failed secret verification retains the legacy credential", async (t) => {
    const fake = await context({ [NOTION_TOKEN_SECRET_KEY]: "legacy-token" });
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    fake.secrets.store = async () => {};
    const storage = new ExtensionStorage();

    await storage.initialize(fake);

    assert.equal(storage.get(NOTION_TOKEN_SECRET_KEY), "legacy-token");
    assert.equal(fake.globalState.values.get(NOTION_TOKEN_SECRET_KEY), "legacy-token");
});

test("all named large collections are file-backed and removed from Memento", async (t) => {
    const values = Object.fromEntries(LARGE_CACHE_KEYS.map((key) => [
        key,
        key === "leetcode-lists" || key === "notion-user-question-tags" ? [] : {},
    ]));
    const fake = await context(values);
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const storage = new ExtensionStorage();

    await storage.initialize(fake);

    for (const key of LARGE_CACHE_KEYS) {
        assert.equal(fake.globalState.values.has(key), false, `${key} remained in Memento`);
        assert.notEqual(storage.get(key), undefined, `${key} missing from snapshot`);
        const envelope = JSON.parse(await readFile(storage.getCacheStore().getFilePath(key), "utf8"));
        assert.equal(envelope.key, key);
    }
});

test("unlisted keys and oversized allowlisted values migrate to files", async (t) => {
    const oversized = "x".repeat(MAX_MEMENTO_VALUE_BYTES + 1);
    const fake = await context({
        "session-123.leetcodeProblems": [{ id: "1" }],
        [MEMENTO_SMALL_VALUE_KEYS[0]]: oversized,
        [MEMENTO_SMALL_VALUE_KEYS[1]]: "42",
    });
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const storage = new ExtensionStorage();

    await storage.initialize(fake);

    assert.deepEqual(storage.get("session-123.leetcodeProblems"), [{ id: "1" }]);
    assert.equal(storage.get(MEMENTO_SMALL_VALUE_KEYS[0]), oversized);
    assert.equal(fake.globalState.values.has("session-123.leetcodeProblems"), false);
    assert.equal(fake.globalState.values.has(MEMENTO_SMALL_VALUE_KEYS[0]), false);
    assert.equal(fake.globalState.values.get(MEMENTO_SMALL_VALUE_KEYS[1]), "42");
});

test("awaited writes and clears update the initialized synchronous snapshot", async (t) => {
    const fake = await context();
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const storage = new ExtensionStorage();
    await storage.initialize(fake);

    await storage.update("leetcode-lists", [{ name: "Favorites", slug: "favorites" }]);
    assert.deepEqual(storage.get("leetcode-lists"), [{ name: "Favorites", slug: "favorites" }]);
    await storage.update(COOKIE_SECRET_KEY, "new-cookie");
    assert.equal(storage.get(COOKIE_SECRET_KEY), "new-cookie");

    await storage.clear(["leetcode-lists", COOKIE_SECRET_KEY]);
    assert.equal(storage.get("leetcode-lists"), undefined);
    assert.equal(storage.get(COOKIE_SECRET_KEY), undefined);
    assert.equal(fake.secrets.values.has(COOKIE_SECRET_KEY), false);
});

const representativeCacheValues = {
    "leetcode-topic-tags": { "two-sum": ["array", "hash-table"] },
    "leetnotion-question-number-page-id-mapping": { "1": "page-id" },
    "leetnotion-title-slug-question-number-mapping": { "two-sum": "1" },
    "notion-user-question-tags": ["redo", "interview"],
    "leetcode-lists": [{ name: "Favorites", slug: "favorites" }],
    "leetcode-questions-of-list": {
        favorites: [{ id: 1, questionFrontendId: "1", title: "Two Sum", titleSlug: "two-sum" }],
    },
    "leetcode-problem-rating-map": {
        "1": { ID: 1, Rating: 1200, ContestID_en: "weekly-contest-1", ProblemIndex: "A" },
    },
    "leetcodeContests": { "Weekly Contest 1": ["1", "2"] },
};

const malformedCacheValues = {
    "leetcode-topic-tags": { "two-sum": "array" },
    "leetnotion-question-number-page-id-mapping": { "1": 12 },
    "leetnotion-title-slug-question-number-mapping": { "two-sum": null },
    "notion-user-question-tags": ["redo", 3],
    "leetcode-lists": [{ name: "Favorites" }],
    "leetcode-questions-of-list": { favorites: [{ id: "1", titleSlug: "two-sum" }] },
    "leetcode-problem-rating-map": { "1": { ID: 1, Rating: "1200", ContestID_en: "one", ProblemIndex: "A" } },
    "leetcodeContests": { "Weekly Contest 1": ["1", 2] },
};

test("each named cache key has a structural validator", () => {
    assert.deepEqual(Object.keys(CACHE_VALIDATORS).sort(), [...LARGE_CACHE_KEYS].sort());
    for (const key of LARGE_CACHE_KEYS) {
        assert.equal(CACHE_VALIDATORS[key](representativeCacheValues[key]), true, `${key} rejected valid data`);
        assert.equal(CACHE_VALIDATORS[key](malformedCacheValues[key]), false, `${key} accepted malformed data`);
    }
});

test("malformed installed files are rejected for every cache schema", async (t) => {
    const fake = await context();
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const cacheRoot = path.join(fake.root, "cache");
    const paths = new CacheStore(cacheRoot, CACHE_VALIDATORS);
    await require("node:fs/promises").mkdir(cacheRoot, { recursive: true });
    for (const key of LARGE_CACHE_KEYS) {
        await require("node:fs/promises").writeFile(paths.getFilePath(key), JSON.stringify({
            version: CACHE_SCHEMA_VERSION,
            key,
            value: malformedCacheValues[key],
        }));
    }
    const storage = new ExtensionStorage();

    await storage.initialize(fake);

    for (const key of LARGE_CACHE_KEYS) {
        assert.equal(storage.get(key), undefined, `${key} loaded malformed installed data`);
    }
});

test("malformed registered and unlisted cache residue is cleared from Memento", async (t) => {
    const fake = await context({
        "leetcode-topic-tags": malformedCacheValues["leetcode-topic-tags"],
        "unlisted-cache-key": () => undefined,
    });
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const storage = new ExtensionStorage();

    await storage.initialize(fake);

    assert.equal(fake.globalState.values.has("leetcode-topic-tags"), false);
    assert.equal(fake.globalState.values.has("unlisted-cache-key"), false);
    assert.equal(storage.get("leetcode-topic-tags"), undefined);
    assert.equal(storage.get("unlisted-cache-key"), undefined);
});

test("empty and non-string secret-key residue is cleared", async (t) => {
    const fake = await context({
        [COOKIE_SECRET_KEY]: "",
        [NOTION_TOKEN_SECRET_KEY]: { token: "not-a-string" },
    });
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const storage = new ExtensionStorage();

    await storage.initialize(fake);

    assert.equal(fake.globalState.values.has(COOKIE_SECRET_KEY), false);
    assert.equal(fake.globalState.values.has(NOTION_TOKEN_SECRET_KEY), false);
    assert.equal(storage.get(COOKIE_SECRET_KEY), undefined);
    assert.equal(storage.get(NOTION_TOKEN_SECRET_KEY), undefined);
});

test("an empty stored secret is replaced from a valid legacy secret", async (t) => {
    const fake = await context({ [COOKIE_SECRET_KEY]: "legacy-cookie" }, { [COOKIE_SECRET_KEY]: "" });
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const storage = new ExtensionStorage();

    await storage.initialize(fake);

    assert.equal(storage.get(COOKIE_SECRET_KEY), "legacy-cookie");
    assert.equal(fake.secrets.values.get(COOKIE_SECRET_KEY), "legacy-cookie");
    assert.equal(fake.globalState.values.has(COOKIE_SECRET_KEY), false);
});

test("SecretStorage read failure retains only a valid legacy secret", async (t) => {
    const valid = await context({ [COOKIE_SECRET_KEY]: "valid-cookie" });
    const invalid = await context({ [COOKIE_SECRET_KEY]: { cookie: "invalid" } });
    t.after(() => Promise.all([
        rm(valid.root, { recursive: true, force: true }),
        rm(invalid.root, { recursive: true, force: true }),
    ]));
    valid.secrets.get = async () => { throw new Error("injected read failure"); };
    invalid.secrets.get = async () => { throw new Error("injected read failure"); };
    const validStorage = new ExtensionStorage();
    const invalidStorage = new ExtensionStorage();

    await validStorage.initialize(valid);
    await invalidStorage.initialize(invalid);

    assert.equal(validStorage.get(COOKIE_SECRET_KEY), "valid-cookie");
    assert.equal(valid.globalState.values.get(COOKIE_SECRET_KEY), "valid-cookie");
    assert.equal(invalidStorage.get(COOKIE_SECRET_KEY), undefined);
    assert.equal(invalid.globalState.values.has(COOKIE_SECRET_KEY), false);
});

test("new empty or non-string secret writes are rejected", async (t) => {
    const fake = await context();
    t.after(() => rm(fake.root, { recursive: true, force: true }));
    const storage = new ExtensionStorage();
    await storage.initialize(fake);

    await assert.rejects(storage.update(COOKIE_SECRET_KEY, "  "), /must be a non-empty string/);
    await assert.rejects(storage.update(NOTION_TOKEN_SECRET_KEY, { token: "invalid" }), /must be a non-empty string/);
    assert.equal(storage.get(COOKIE_SECRET_KEY), undefined);
    assert.equal(storage.get(NOTION_TOKEN_SECRET_KEY), undefined);
});
