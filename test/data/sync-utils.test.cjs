const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "..", "..");

async function syncUtils() {
    return import(pathToFileURL(path.join(repositoryRoot, "scripts", "lib", "sync-utils.mjs")));
}

async function withServer(handler, run) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
        return await run(`http://127.0.0.1:${address.port}`);
    } finally {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
    }
}

test("downloadText enforces timeout", async () => {
    const sync = await syncUtils();
    await withServer((_request, _response) => {}, async (baseUrl) => {
        await assert.rejects(
            sync.downloadText(baseUrl, { maxBytes: 100, timeoutMs: 20 }),
            /timed out after 20ms/,
        );
    });
});

test("downloadText enforces declared and streamed byte limits", async () => {
    const sync = await syncUtils();
    await withServer((request, response) => {
        if (request.url === "/declared") {
            response.writeHead(200, { "Content-Length": "1000" });
            response.end("small");
        } else {
            response.writeHead(200);
            response.end("0123456789");
        }
    }, async (baseUrl) => {
        await assert.rejects(sync.downloadText(`${baseUrl}/declared`, { maxBytes: 5 }), /exceeded 5 bytes/);
        await assert.rejects(sync.downloadText(`${baseUrl}/streamed`, { maxBytes: 5 }), /exceeded 5 bytes/);
    });
});

test("downloadText allows no more than the configured redirects", async () => {
    const sync = await syncUtils();
    await withServer((request, response) => {
        const count = Number(request.url.slice(1) || "0");
        response.writeHead(302, { Location: `/${count + 1}` });
        response.end();
    }, async (baseUrl) => {
        await assert.rejects(
            sync.downloadText(`${baseUrl}/0`, { maxBytes: 100, maxRedirects: 2 }),
            /Too many redirects/,
        );
    });
});

test("sibling temp paths are unique and stay beside the target", async () => {
    const sync = await syncUtils();
    const target = path.join("some", "directory", "output.json");
    const first = sync.createSiblingTempPath(target);
    const second = sync.createSiblingTempPath(target);
    assert.notEqual(first, second);
    assert.equal(path.dirname(first), path.dirname(target));
    assert.equal(path.dirname(second), path.dirname(target));
});

test("atomicWriteFiles replaces all outputs and cleans temporary files", async () => {
    const sync = await syncUtils();
    const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "atomic-output-"));
    const first = path.join(temporaryRoot, "first.json");
    const second = path.join(temporaryRoot, "second.json");
    try {
        fs.writeFileSync(first, "old-first");
        fs.writeFileSync(second, "old-second");
        sync.atomicWriteFiles([
            { path: first, content: "new-first" },
            { path: second, content: "new-second" },
        ], {
            validate: (staged) => {
                assert.equal(fs.readFileSync(staged.get(first), "utf8"), "new-first");
                assert.equal(fs.readFileSync(staged.get(second), "utf8"), "new-second");
            },
        });
        assert.equal(fs.readFileSync(first, "utf8"), "new-first");
        assert.equal(fs.readFileSync(second, "utf8"), "new-second");
        assert.deepEqual(fs.readdirSync(temporaryRoot).sort(), ["first.json", "second.json"]);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test("atomicWriteFiles rolls back earlier outputs after a rename failure", async () => {
    const sync = await syncUtils();
    const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "atomic-rollback-"));
    const first = path.join(temporaryRoot, "first.json");
    const second = path.join(temporaryRoot, "second.json");
    fs.writeFileSync(first, "old-first");
    fs.writeFileSync(second, "old-second");
    let renameCalls = 0;
    try {
        assert.throws(() => sync.atomicWriteFiles([
            { path: first, content: "new-first" },
            { path: second, content: "new-second" },
        ], {
            fsOperations: {
                renameSync: (from, to) => {
                    renameCalls += 1;
                    if (renameCalls === 4) { throw new Error("simulated rename failure"); }
                    fs.renameSync(from, to);
                },
            },
        }), /simulated rename failure/);
        assert.equal(fs.readFileSync(first, "utf8"), "old-first");
        assert.equal(fs.readFileSync(second, "utf8"), "old-second");
        assert.deepEqual(fs.readdirSync(temporaryRoot).sort(), ["first.json", "second.json"]);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});
