import { access, readFile, rm } from "fs/promises";
import { constants as fsConstants } from "fs";
import { dirname, join, resolve } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));

export const VSCE_VERSION = "2.15.0";
export const vsixPath = join(repositoryRoot, `${packageManifest.name}-${packageManifest.version}.vsix`);

async function pathExists(path) {
    try {
        await access(path, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function run(command, args, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: repositoryRoot,
            stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        if (options.capture) {
            child.stdout.on("data", (chunk) => { stdout += chunk; });
            child.stderr.on("data", (chunk) => { stderr += chunk; });
        }
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal || code !== 0) {
                rejectPromise(new Error(`${command} failed (${signal || `exit ${code}`}): ${stderr.trim()}`));
                return;
            }
            resolvePromise(stdout.trim());
        });
    });
}

async function resolveVsceCommand() {
    const localManifestPath = join(repositoryRoot, "node_modules", "@vscode", "vsce", "package.json");
    if (await pathExists(localManifestPath)) {
        const localManifest = JSON.parse(await readFile(localManifestPath, "utf8"));
        if (localManifest.version !== VSCE_VERSION) {
            throw new Error(`Local VSCE must be ${VSCE_VERSION}; found ${localManifest.version || "an unknown version"}.`);
        }
        const localCli = join(dirname(localManifestPath), localManifest.bin.vsce);
        const version = await run(process.execPath, [localCli, "--version"], { capture: true });
        if (version !== VSCE_VERSION) {
            throw new Error(`Local VSCE must be ${VSCE_VERSION}; found ${version || "an unknown version"}.`);
        }
        return { command: process.execPath, prefixArgs: [localCli] };
    }

    const npmCli = process.env.npm_execpath;
    if (!npmCli) {
        throw new Error("VSCE is not installed locally. Run packaging through `npm run package` so the pinned fallback can be used.");
    }
    return {
        command: process.execPath,
        prefixArgs: [npmCli, "exec", "--yes", `--package=@vscode/vsce@${VSCE_VERSION}`, "--", "vsce"],
    };
}

async function main() {
    await rm(vsixPath, { force: true });
    const vsce = await resolveVsceCommand();
    await run(vsce.command, [...vsce.prefixArgs, "package", "--out", vsixPath]);
    process.stdout.write(`Packaged ${vsixPath}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
