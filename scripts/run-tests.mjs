import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(repositoryRoot, "test");
const typescriptCompiler = path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");

export async function discoverTests(directory = testRoot) {
    const tests = [];

    async function visit(currentDirectory) {
        const entries = await readdir(currentDirectory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            const entryPath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                await visit(entryPath);
            } else if (entry.isFile() && entry.name.endsWith(".test.cjs")) {
                tests.push(entryPath);
            }
        }
    }

    await visit(directory);
    return tests;
}

function run(commandArguments) {
    return spawnSync(process.execPath, commandArguments, {
        cwd: repositoryRoot,
        stdio: "inherit",
    });
}

export async function runTests(requestedTests = []) {
    const compilation = run([typescriptCompiler, "--project", "tsconfig.test.json"]);
    if (compilation.error) {
        throw compilation.error;
    }
    if (compilation.status !== 0) {
        return compilation.status ?? 1;
    }

    const tests = requestedTests.length > 0 ? requestedTests : await discoverTests();
    if (tests.length === 0) {
        console.error("No test files matched test/**/*.test.cjs");
        return 1;
    }

    const testRun = run(["--test", ...tests]);
    if (testRun.error) {
        throw testRun.error;
    }
    return testRun.status ?? 1;
}

const invokedAsScript = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
    try {
        process.exitCode = await runTests(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
