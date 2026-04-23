import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeExecutable = process.execPath;
const rolldownCli = join(rootDir, "node_modules", "rolldown", "bin", "cli.mjs");

const buildTargets = [
    {
        label: "extension",
        args: [
            "src/extension.ts",
            "-o",
            "out/src/extension.js",
            "-f",
            "cjs",
            "-p",
            "node",
            "-e",
            "vscode",
            "-m",
            "--transform.target",
            "es2015",
            "--checks.eval=false",
            "--tsconfig",
            "tsconfig.json",
            "--external",
            "bottleneck",
        ],
        outputFile: "out/src/extension.js",
    },
    {
        label: "webview",
        args: [
            "src/webview/vscode-components.mts",
            "-o",
            "public/scripts/vscode-components.js",
            "-f",
            "esm",
            "-p",
            "browser",
            "-m",
            "--transform.target",
            "es2020",
            "--tsconfig",
            "tsconfig.json",
        ],
        outputFile: "public/scripts/vscode-components.js",
    },
];

async function main() {
    await Promise.all(buildTargets.map(async (target) => {
        await mkdir(dirname(resolve(rootDir, target.outputFile)), { recursive: true });
    }));

    for (const target of buildTargets) {
        await runCommand(`rolldown ${target.label} build`, rolldownCli, target.args);
    }
}

function runCommand(label, command, args) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(nodeExecutable, [command, ...args], {
            cwd: rootDir,
            stdio: "inherit",
        });

        child.on("error", (error) => {
            rejectPromise(new Error(`${label} failed to start: ${error.message}`));
        });

        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${label} exited with signal ${signal}`));
                return;
            }

            if (code !== 0) {
                rejectPromise(new Error(`${label} exited with code ${code}`));
                return;
            }

            resolvePromise();
        });
    });
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
