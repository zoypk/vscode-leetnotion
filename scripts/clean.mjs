import { rm } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const GENERATED_TARGETS = Object.freeze([
    "out",
    "out-test",
    ".vscode-test",
    "public/scripts/vscode-components.js",
]);

export async function cleanGeneratedTargets(rootDir = repositoryRoot) {
    const normalizedRoot = resolve(rootDir);

    for (const relativePath of GENERATED_TARGETS) {
        const target = resolve(normalizedRoot, relativePath);
        if (target === normalizedRoot || !target.startsWith(`${normalizedRoot}${process.platform === "win32" ? "\\" : "/"}`)) {
            throw new Error(`Refusing to clean target outside repository root: ${target}`);
        }
        await rm(target, { force: true, recursive: true });
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    cleanGeneratedTargets().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
