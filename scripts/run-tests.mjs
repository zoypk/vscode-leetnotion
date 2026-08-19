import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(repositoryRoot, "test");
const compiledTestRoot = path.join(repositoryRoot, "out-test");
const typescriptCompiler = path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const booleanTestOptions = new Set(["--test-only"]);
const valuedTestOptions = new Set(["--test-name-pattern"]);

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

export function normalizeTestArguments(argumentsToNormalize) {
    const runnerOptions = [];
    const testFiles = [];
    let positionalOnly = false;

    for (let index = 0; index < argumentsToNormalize.length; index += 1) {
        const argument = argumentsToNormalize[index];
        if (positionalOnly) {
            testFiles.push(argument);
            continue;
        }
        if (argument === "--") {
            positionalOnly = true;
            continue;
        }
        if (!argument.startsWith("-")) {
            testFiles.push(argument);
            continue;
        }

        const equalsIndex = argument.indexOf("=");
        const optionName = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
        if (booleanTestOptions.has(optionName)) {
            if (equalsIndex !== -1) {
                throw new Error(`${optionName} does not accept a value`);
            }
            runnerOptions.push(optionName);
            continue;
        }
        if (!valuedTestOptions.has(optionName)) {
            throw new Error(`Unsupported test runner option: ${optionName}`);
        }

        if (equalsIndex !== -1) {
            const value = argument.slice(equalsIndex + 1);
            if (!value) {
                throw new Error(`${optionName} requires a value`);
            }
            runnerOptions.push(optionName, value);
            continue;
        }

        const value = argumentsToNormalize[index + 1];
        if (!value || value.startsWith("-")) {
            throw new Error(`${optionName} requires a value`);
        }
        runnerOptions.push(optionName, value);
        index += 1;
    }

    return { runnerOptions, testFiles };
}

async function cleanCompiledTests() {
    const relativeOutput = path.relative(repositoryRoot, compiledTestRoot);
    const outsideRepository = relativeOutput === ""
        || relativeOutput === ".."
        || relativeOutput.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeOutput);
    if (outsideRepository) {
        throw new Error(`Refusing to clean unsafe test output path: ${compiledTestRoot}`);
    }
    await rm(compiledTestRoot, { recursive: true, force: true });
}

export async function runTests(requestedTests = []) {
    const { runnerOptions, testFiles } = normalizeTestArguments(requestedTests);
    await cleanCompiledTests();
    const compilation = run([typescriptCompiler, "--project", "tsconfig.test.json"]);
    if (compilation.error) {
        throw compilation.error;
    }
    if (compilation.status !== 0) {
        return compilation.status ?? 1;
    }

    const tests = testFiles.length > 0 ? testFiles : await discoverTests();
    if (tests.length === 0) {
        console.error("No test files matched test/**/*.test.cjs");
        return 1;
    }

    const testRun = run(["--test", "--test-concurrency=1", ...runnerOptions, ...tests]);
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
