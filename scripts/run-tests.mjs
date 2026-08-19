import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(repositoryRoot, "test");
const compiledTestBase = path.join(repositoryRoot, "out-test");
const typescriptCompiler = path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const booleanTestOptions = new Set(["--test-only"]);
const valuedTestOptions = new Set(["--test-name-pattern"]);
const activeOutputEnvironmentKey = "LEETNOTION_TEST_ACTIVE_OUTPUT_ROOT";
const requestedOutputEnvironmentKey = "LEETNOTION_TEST_OUTPUT_ROOT";
const outputLockWaitMilliseconds = 120_000;
const incompleteLockGraceMilliseconds = 500;

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

function run(commandArguments, environment = process.env) {
    return spawnSync(process.execPath, commandArguments, {
        cwd: repositoryRoot,
        env: environment,
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

function assertSafeCompiledTestRoot(compiledTestRoot) {
    const relativeOutput = path.relative(compiledTestBase, compiledTestRoot);
    const outsideOutputBase = relativeOutput === ".."
        || relativeOutput.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeOutput);
    if (outsideOutputBase) {
        throw new Error(`Refusing to use unsafe test output path: ${compiledTestRoot}`);
    }

    const relativeRepositoryOutput = path.relative(repositoryRoot, compiledTestRoot);
    const outsideRepository = relativeRepositoryOutput === ""
        || relativeRepositoryOutput === ".."
        || relativeRepositoryOutput.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeRepositoryOutput);
    if (outsideRepository) {
        throw new Error(`Refusing to use unsafe test output path: ${compiledTestRoot}`);
    }
}

export function resolveCompiledTestRoot(environment = process.env) {
    const requestedOutput = environment[requestedOutputEnvironmentKey];
    const activeParentOutput = environment[activeOutputEnvironmentKey];
    const compiledTestRoot = requestedOutput
        ? path.resolve(repositoryRoot, requestedOutput)
        : activeParentOutput
            ? path.join(compiledTestBase, ".nested", `${process.pid}-${randomUUID()}`)
            : compiledTestBase;
    assertSafeCompiledTestRoot(compiledTestRoot);
    return compiledTestRoot;
}

async function cleanCompiledTests(compiledTestRoot) {
    await rm(compiledTestRoot, { recursive: true, force: true });
}

async function acquireOutputLock(compiledTestRoot) {
    const lockPath = `${compiledTestRoot}.lock`;
    await mkdir(path.dirname(lockPath), { recursive: true });
    const deadline = Date.now() + outputLockWaitMilliseconds;
    const token = randomUUID();

    while (true) {
        let handle;
        try {
            handle = await open(lockPath, "wx");
            try {
                await handle.writeFile(JSON.stringify({ pid: process.pid, token }), "utf8");
            } finally {
                await handle.close();
            }
            return async () => {
                try {
                    const owner = JSON.parse(await readFile(lockPath, "utf8"));
                    if (owner.token === token) {
                        await rm(lockPath, { force: true });
                    }
                } catch (error) {
                    if (!error || error.code !== "ENOENT") {
                        throw error;
                    }
                }
            };
        } catch (error) {
            if (handle) {
                await rm(lockPath, { force: true });
            }
            if (!error || error.code !== "EEXIST") {
                throw error;
            }

            const owner = await readOutputLockOwner(lockPath, compiledTestRoot);
            if (!owner) {
                continue;
            }
            if (!isProcessRunning(owner.pid)) {
                throw new Error(
                    `Test output lock is stale: ${lockPath} `
                    + `(owner PID ${owner.pid}, token ${owner.token}). `
                    + `Remove this lock manually after confirming no test runner is using ${compiledTestRoot}.`,
                );
            }
            if (Date.now() >= deadline) {
                throw new Error(
                    `Timed out waiting for test output lock: ${lockPath} `
                    + `(live owner PID ${owner.pid}, token ${owner.token}).`,
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
}

async function readOutputLockOwner(lockPath, compiledTestRoot) {
    const deadline = Date.now() + incompleteLockGraceMilliseconds;
    do {
        try {
            const owner = JSON.parse(await readFile(lockPath, "utf8"));
            if (Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.token === "string") {
                return owner;
            }
        } catch (error) {
            if (error && error.code === "ENOENT") {
                return undefined;
            }
            if (!(error instanceof SyntaxError)) {
                throw error;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);

    throw new Error(
        `Test output lock is incomplete: ${lockPath}. `
        + `Remove this lock manually after confirming no test runner is using ${compiledTestRoot}.`,
    );
}

function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return Boolean(error && error.code === "EPERM");
    }
}

export async function runTests(requestedTests = []) {
    const { runnerOptions, testFiles } = normalizeTestArguments(requestedTests);
    const compiledTestRoot = resolveCompiledTestRoot();
    const releaseOutputLock = await acquireOutputLock(compiledTestRoot);
    const removeOutputAfterRun = compiledTestRoot !== compiledTestBase;

    try {
        await cleanCompiledTests(compiledTestRoot);
        const compilation = run([
            typescriptCompiler,
            "--project", "tsconfig.test.json",
            "--outDir", compiledTestRoot,
        ]);
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

        const testEnvironment = {
            ...process.env,
            [activeOutputEnvironmentKey]: compiledTestRoot,
        };
        delete testEnvironment[requestedOutputEnvironmentKey];
        const testRun = run(
            ["--test", "--test-concurrency=1", ...runnerOptions, ...tests],
            testEnvironment,
        );
        if (testRun.error) {
            throw testRun.error;
        }
        return testRun.status ?? 1;
    } finally {
        try {
            if (removeOutputAfterRun) {
                await rm(compiledTestRoot, { recursive: true, force: true });
            }
        } finally {
            await releaseOutputLock();
        }
    }
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
