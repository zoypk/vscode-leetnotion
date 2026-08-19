import { readFile, stat } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_COUNT_LIMIT = 2_500;
const UNPACKED_SIZE_LIMIT = 50 * 1024 * 1024;
const VSIX_SIZE_LIMIT = 15 * 1024 * 1024;

const REQUIRED_RUNTIME_PATHS = Object.freeze([
    "[Content_Types].xml",
    "extension.vsixmanifest",
    "extension/package.json",
    "extension/out/src/extension.js",
    "extension/resources/blank.png",
    "extension/resources/check.png",
    "extension/resources/dark/dislike.png",
    "extension/resources/dark/like.png",
    "extension/resources/LeetCode.svg",
    "extension/resources/LeetNotion.png",
    "extension/resources/light/dislike.png",
    "extension/resources/light/like.png",
    "extension/resources/lock.png",
    "extension/resources/x.png",
    "extension/public/scripts/jquery.min.js",
    "extension/public/scripts/profile-dashboard.js",
    "extension/public/scripts/script.js",
    "extension/public/scripts/select2.min.js",
    "extension/public/scripts/vscode-components.js",
    "extension/public/scripts/webview-actions.js",
    "extension/public/styles/select2.min.css",
    "extension/public/styles/style.css",
    "extension/data/company-data.json",
    "extension/data/company-data-provenance.json",
    "extension/data/companyTags.json",
    "extension/data/questionCompanyTags.json",
    "extension/data/jit-learning-resources.json",
    "extension/data/neetcode-index.json",
    "extension/data/sheets.json",
    "extension/node_modules/bottleneck/package.json",
    "extension/node_modules/bottleneck/lib/index.js",
    "extension/node_modules/ts-fsrs/package.json",
    "extension/node_modules/ts-fsrs/dist/index.cjs",
    "extension/node_modules/vsc-leetcode-cli/package.json",
    "extension/node_modules/vsc-leetcode-cli/bin/leetcode",
    "extension/node_modules/vsc-leetcode-cli/lib/cli.js",
    "extension/node_modules/lodash/lodash.js",
]);

const FORBIDDEN_PREFIXES = Object.freeze([
    "extension/.github/",
    "extension/.vscode/",
    "extension/.vscode-test/",
    "extension/docs/",
    "extension/scripts/",
    "extension/src/",
    "extension/test/",
    "extension/out/test/",
    "extension/out-test/",
    "extension/node_modules/@types/",
    "extension/node_modules/@vscode/vsce/",
    "extension/node_modules/esbuild/",
    "extension/node_modules/rolldown/",
    "extension/node_modules/tslint/",
    "extension/node_modules/typescript/",
]);

const FORBIDDEN_EXACT_PATHS = Object.freeze([
    "extension/data/neetcode-enrichment.json",
    "extension/esbuild.js",
    "extension/package-lock.json",
    "extension/tsconfig.json",
    "extension/tslint.json",
]);

function findEndOfCentralDirectory(buffer) {
    const minimumOffset = Math.max(0, buffer.length - 65_557);
    for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) {
            return offset;
        }
    }
    throw new Error("VSIX is not a valid ZIP archive: end-of-central-directory record is missing.");
}

export function parseZipEntries(buffer) {
    const endOffset = findEndOfCentralDirectory(buffer);
    const entryCount = buffer.readUInt16LE(endOffset + 10);
    const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
    if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
        throw new Error("ZIP64 VSIX archives are not supported by this verifier.");
    }
    if (centralDirectoryOffset + centralDirectorySize > endOffset) {
        throw new Error("VSIX central directory extends beyond the archive boundary.");
    }

    const entries = [];
    let offset = centralDirectoryOffset;
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error(`VSIX central-directory entry ${index + 1} is malformed.`);
        }
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const endOfEntry = offset + 46 + fileNameLength + extraLength + commentLength;
        if (endOfEntry > buffer.length) {
            throw new Error(`VSIX central-directory entry ${index + 1} extends beyond the archive boundary.`);
        }
        const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
        entries.push({
            name,
            uncompressedSize: buffer.readUInt32LE(offset + 24),
        });
        offset = endOfEntry;
    }
    if (offset !== centralDirectoryOffset + centralDirectorySize) {
        throw new Error("VSIX central-directory size does not match its entries.");
    }
    return entries;
}

export function requiredVsixPaths(neetCodeIndex) {
    const contentFiles = Object.values(neetCodeIndex?.problems || {})
        .map((problem) => problem?.contentFile)
        .filter((path) => typeof path === "string")
        .map((path) => `extension/data/${path}`);
    return [...REQUIRED_RUNTIME_PATHS, ...contentFiles];
}

export function validateVsixEntries(entries, { requiredPaths, vsixSize }) {
    const errors = [];
    const files = entries.filter((entry) => !entry.name.endsWith("/"));
    const names = new Set();
    let unpackedSize = 0;

    for (const entry of files) {
        const normalized = entry.name.replace(/\\/g, "/");
        if (normalized !== entry.name || normalized.startsWith("/") || normalized.split("/").includes("..")) {
            errors.push(`unsafe archive path: ${entry.name}`);
        }
        if (names.has(normalized)) {
            errors.push(`duplicate archive path: ${normalized}`);
        }
        names.add(normalized);
        unpackedSize += entry.uncompressedSize;

        const lowerName = normalized.toLowerCase();
        if (lowerName.endsWith(".map")) {
            errors.push(`source map is forbidden: ${normalized}`);
        }
        if (FORBIDDEN_PREFIXES.some((prefix) => lowerName.startsWith(prefix.toLowerCase()))) {
            errors.push(`forbidden packaged path: ${normalized}`);
        }
        if (FORBIDDEN_EXACT_PATHS.some((path) => lowerName === path.toLowerCase())) {
            errors.push(`forbidden packaged path: ${normalized}`);
        }
    }

    for (const requiredPath of requiredPaths) {
        if (!names.has(requiredPath)) {
            errors.push(`required packaged path is missing: ${requiredPath}`);
        }
    }
    if (files.length > FILE_COUNT_LIMIT) {
        errors.push(`file count ${files.length} exceeds ${FILE_COUNT_LIMIT}`);
    }
    if (unpackedSize > UNPACKED_SIZE_LIMIT) {
        errors.push(`unpacked size ${unpackedSize} exceeds ${UNPACKED_SIZE_LIMIT} bytes`);
    }
    if (vsixSize > VSIX_SIZE_LIMIT) {
        errors.push(`VSIX size ${vsixSize} exceeds ${VSIX_SIZE_LIMIT} bytes`);
    }
    if (errors.length > 0) {
        throw new Error(`VSIX contract failed:\n- ${errors.join("\n- ")}`);
    }
    return { fileCount: files.length, unpackedSize, vsixSize };
}

async function main() {
    const packageManifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
    const neetCodeIndex = JSON.parse(await readFile(join(repositoryRoot, "data", "neetcode-index.json"), "utf8"));
    const artifactPath = resolve(process.argv[2] || join(repositoryRoot, `${packageManifest.name}-${packageManifest.version}.vsix`));
    const [archive, artifactStats] = await Promise.all([readFile(artifactPath), stat(artifactPath)]);
    const result = validateVsixEntries(parseZipEntries(archive), {
        requiredPaths: requiredVsixPaths(neetCodeIndex),
        vsixSize: artifactStats.size,
    });
    process.stdout.write(`VSIX verified: ${artifactPath}\n`);
    process.stdout.write(`Files: ${result.fileCount}; unpacked: ${result.unpackedSize} bytes; VSIX: ${result.vsixSize} bytes\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
