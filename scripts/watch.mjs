import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeExecutable = process.execPath;
const rolldownCli = join(rootDir, "node_modules", "rolldown", "bin", "cli.mjs");

const watchTargets = [
    {
        label: "extension bundle",
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
            "--tsconfig",
            "tsconfig.json",
            "-w",
        ],
        outputFile: "out/src/extension.js",
    },
    {
        label: "webview bundle",
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
            "-w",
        ],
        outputFile: "public/scripts/vscode-components.js",
    },
];

const children = new Set();
let shuttingDown = false;

async function main() {
    await Promise.all(watchTargets
        .filter((target) => Boolean(target.outputFile))
        .map(async (target) => {
            await mkdir(dirname(resolve(rootDir, target.outputFile)), { recursive: true });
        }));

    for (const target of watchTargets) {
        startProcess(target.label, target.command ?? rolldownCli, target.args);
    }

    process.on("SIGINT", () => {
        void shutdown(0);
    });

    process.on("SIGTERM", () => {
        void shutdown(0);
    });
}

function startProcess(label, command, args) {
    console.log(`[watch] starting ${label}`);

    const child = spawn(nodeExecutable, [command, ...args], {
        cwd: rootDir,
        stdio: "inherit",
    });

    children.add(child);

    child.on("error", (error) => {
        if (shuttingDown) {
            return;
        }

        void shutdown(1, `${label} failed to start: ${error.message}`);
    });

    child.on("exit", (code, signal) => {
        children.delete(child);

        if (shuttingDown) {
            return;
        }

        const reason = signal ? `signal ${signal}` : `code ${code}`;
        void shutdown(code ?? 1, `${label} exited unexpectedly with ${reason}`);
    });
}

async function shutdown(exitCode, message) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    if (message) {
        process.stderr.write(`${message}\n`);
    }

    for (const child of children) {
        try {
            child.kill();
        } catch {
            // Ignore failures while stopping watch children.
        }
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    process.exit(exitCode);
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
