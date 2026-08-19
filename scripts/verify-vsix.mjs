import { execFile } from "child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";
import { promisify } from "util";
import { inflateRawSync } from "zlib";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_COUNT_LIMIT = 2_500;
const UNPACKED_SIZE_LIMIT = 50 * 1024 * 1024;
const VSIX_SIZE_LIMIT = 15 * 1024 * 1024;
const MAX_JSON_SIZE = 2 * 1024 * 1024;

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
        if (buffer.readUInt32LE(offset) !== 0x06054b50) {
            continue;
        }
        const commentLength = buffer.readUInt16LE(offset + 20);
        if (offset + 22 + commentLength === buffer.length) {
            return offset;
        }
    }
    throw new Error("VSIX is not a valid ZIP archive: end-of-central-directory record is missing.");
}

export function parseZipEntries(buffer) {
    const endOffset = findEndOfCentralDirectory(buffer);
    const diskNumber = buffer.readUInt16LE(endOffset + 4);
    const centralDirectoryDisk = buffer.readUInt16LE(endOffset + 6);
    const diskEntryCount = buffer.readUInt16LE(endOffset + 8);
    const entryCount = buffer.readUInt16LE(endOffset + 10);
    const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || diskEntryCount !== entryCount) {
        throw new Error("Multi-disk VSIX archives are not supported.");
    }
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
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
            throw new Error(`VSIX central-directory entry ${index + 1} uses unsupported ZIP64 fields.`);
        }
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const endOfEntry = offset + 46 + fileNameLength + extraLength + commentLength;
        if (endOfEntry > buffer.length) {
            throw new Error(`VSIX central-directory entry ${index + 1} extends beyond the archive boundary.`);
        }
        const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
        const versionMadeBy = buffer.readUInt16LE(offset + 4);
        const externalAttributes = buffer.readUInt32LE(offset + 38);
        const unixMode = versionMadeBy >> 8 === 3 ? (externalAttributes >>> 16) & 0xffff : 0;
        entries.push({
            name,
            flags: buffer.readUInt16LE(offset + 8),
            compressionMethod: buffer.readUInt16LE(offset + 10),
            compressedSize,
            uncompressedSize,
            localHeaderOffset,
            isSymlink: (unixMode & 0o170000) === 0o120000,
        });
        offset = endOfEntry;
    }
    if (offset !== centralDirectoryOffset + centralDirectorySize) {
        throw new Error("VSIX central-directory size does not match its entries.");
    }
    return entries;
}

function archivePathRecord(entry) {
    const name = entry.name;
    if (typeof name !== "string" || name.length === 0) {
        throw new Error("empty archive path");
    }
    if (name.includes("\\")) {
        throw new Error(`archive path uses a backslash: ${name}`);
    }
    if (name.startsWith("/") || /^[a-z]:/i.test(name)) {
        throw new Error(`absolute or drive archive path: ${name}`);
    }
    const isDirectory = name.endsWith("/");
    const withoutDirectorySlash = isDirectory ? name.slice(0, -1) : name;
    if (!withoutDirectorySlash) {
        throw new Error(`archive path has no filename: ${name}`);
    }
    const segments = withoutDirectorySlash.split("/");
    for (const segment of segments) {
        if (!segment || segment === "." || segment === "..") {
            throw new Error(`archive path contains an empty, dot, or traversal segment: ${name}`);
        }
        if (/[ .]$/.test(segment)) {
            throw new Error(`archive path has a Windows-trimmed segment: ${name}`);
        }
        if (/[<>:"|?*\u0000-\u001f]/.test(segment)) {
            throw new Error(`archive path contains a Windows-invalid or ADS character: ${name}`);
        }
        const deviceStem = segment.split(".", 1)[0].toUpperCase();
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceStem)) {
            throw new Error(`archive path contains a reserved Windows device name: ${name}`);
        }
    }
    if (entry.isSymlink) {
        throw new Error(`symbolic links are forbidden in the VSIX: ${name}`);
    }
    return {
        canonical: segments.map((segment) => segment.toLowerCase()).join("/"),
        isDirectory,
        name,
    };
}

function validateArchivePaths(entries) {
    const records = [];
    const recordsByCanonical = new Map();
    const errors = [];

    for (const entry of entries) {
        let record;
        try {
            record = archivePathRecord(entry);
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
            continue;
        }
        const existing = recordsByCanonical.get(record.canonical);
        if (existing) {
            if (existing.isDirectory !== record.isDirectory) {
                errors.push(`file-directory collision: ${existing.name} and ${record.name}`);
            } else if (existing.name === record.name) {
                errors.push(`duplicate archive path: ${record.name}`);
            } else {
                errors.push(`case-insensitive archive collision: ${existing.name} and ${record.name}`);
            }
            continue;
        }
        recordsByCanonical.set(record.canonical, record);
        records.push(record);
    }

    for (const record of records) {
        const segments = record.canonical.split("/");
        for (let index = 1; index < segments.length; index += 1) {
            const ancestor = recordsByCanonical.get(segments.slice(0, index).join("/"));
            if (ancestor && !ancestor.isDirectory) {
                errors.push(`file-descendant collision: ${ancestor.name} and ${record.name}`);
            }
        }
    }
    return { errors, records };
}

export function requiredVsixPaths(neetCodeIndex) {
    const contentFiles = Object.values(neetCodeIndex?.problems || {})
        .map((problem) => problem?.contentFile)
        .filter((path) => typeof path === "string")
        .map((path) => `extension/data/${path}`);
    return [...REQUIRED_RUNTIME_PATHS, ...contentFiles];
}

export function validateVsixEntries(entries, { requiredPaths, vsixSize }) {
    const pathValidation = validateArchivePaths(entries);
    const errors = [...pathValidation.errors];
    const files = entries.filter((entry) => !entry.name.endsWith("/"));
    const names = new Set(files.map((entry) => entry.name));
    let unpackedSize = 0;

    for (const entry of files) {
        unpackedSize += entry.uncompressedSize;
        const lowerName = entry.name.toLowerCase();
        if (lowerName.endsWith(".map")) {
            errors.push(`source map is forbidden: ${entry.name}`);
        }
        if (FORBIDDEN_PREFIXES.some((prefix) => lowerName.startsWith(prefix.toLowerCase()))) {
            errors.push(`forbidden packaged path: ${entry.name}`);
        }
        if (FORBIDDEN_EXACT_PATHS.some((path) => lowerName === path.toLowerCase())) {
            errors.push(`forbidden packaged path: ${entry.name}`);
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
    if (!Number.isSafeInteger(vsixSize) || vsixSize < 0 || vsixSize > VSIX_SIZE_LIMIT) {
        errors.push(`VSIX size ${vsixSize} exceeds ${VSIX_SIZE_LIMIT} bytes or is invalid`);
    }
    if (errors.length > 0) {
        throw new Error(`VSIX contract failed:\n- ${errors.join("\n- ")}`);
    }
    return { fileCount: files.length, unpackedSize, vsixSize };
}

export function readZipEntry(archive, entry) {
    if (!entry || entry.name.endsWith("/")) {
        throw new Error("Cannot read a missing or directory ZIP entry.");
    }
    const offset = entry.localHeaderOffset;
    if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== 0x04034b50) {
        throw new Error(`Malformed local ZIP header for ${entry.name}.`);
    }
    const flags = archive.readUInt16LE(offset + 6);
    const compressionMethod = archive.readUInt16LE(offset + 8);
    if ((flags & 1) !== 0 || (entry.flags & 1) !== 0) {
        throw new Error(`Encrypted ZIP entry is forbidden: ${entry.name}`);
    }
    if (flags !== entry.flags || compressionMethod !== entry.compressionMethod) {
        throw new Error(`Central and local ZIP headers disagree for ${entry.name}.`);
    }
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const dataOffset = offset + 30 + fileNameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataEnd > archive.length) {
        throw new Error(`Compressed data extends beyond the VSIX for ${entry.name}.`);
    }
    const localName = archive.subarray(offset + 30, offset + 30 + fileNameLength).toString("utf8");
    if (localName !== entry.name) {
        throw new Error(`Central and local ZIP names disagree for ${entry.name}.`);
    }
    const compressed = archive.subarray(dataOffset, dataEnd);
    let content;
    if (compressionMethod === 0) {
        content = Buffer.from(compressed);
    } else if (compressionMethod === 8) {
        content = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
    } else {
        throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${entry.name}.`);
    }
    if (content.length !== entry.uncompressedSize) {
        throw new Error(`Uncompressed size mismatch for ${entry.name}.`);
    }
    return content;
}

function expectedPackageName(packagePath) {
    const marker = packagePath.lastIndexOf("node_modules/");
    const suffix = packagePath.slice(marker + "node_modules/".length);
    const parts = suffix.split("/");
    return parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function resolveLockedDependency(packages, parentPackagePath, dependencyName) {
    let current = parentPackagePath;
    while (true) {
        const candidate = `${current ? `${current}/` : ""}node_modules/${dependencyName}`;
        if (packages[candidate]) {
            return candidate;
        }
        if (!current) {
            break;
        }
        const nestedMarker = current.lastIndexOf("/node_modules/");
        current = nestedMarker >= 0 ? current.slice(0, nestedMarker) : "";
    }
    throw new Error(`package-lock.json does not resolve ${dependencyName} from ${parentPackagePath || "the extension root"}`);
}

export function productionDependencyClosure(lockfile) {
    const packages = lockfile?.packages;
    const root = packages?.[""];
    if (!packages || !root || !root.dependencies || typeof root.dependencies !== "object") {
        throw new Error("package-lock.json is missing the root production dependency map.");
    }
    const queue = Object.keys(root.dependencies).map((name) => resolveLockedDependency(packages, "", name));
    const closure = new Set();
    while (queue.length > 0) {
        const packagePath = queue.shift();
        if (closure.has(packagePath)) {
            continue;
        }
        closure.add(packagePath);
        const lockedPackage = packages[packagePath];
        if (!lockedPackage || lockedPackage.dev || lockedPackage.optional) {
            throw new Error(`Required production package is incorrectly marked dev/optional: ${packagePath}`);
        }
        for (const dependencyName of Object.keys(lockedPackage.dependencies || {})) {
            queue.push(resolveLockedDependency(packages, packagePath, dependencyName));
        }
    }
    return [...closure].sort();
}

function packageRelativePath(declaredPath, label) {
    if (typeof declaredPath !== "string" || !declaredPath.trim()) {
        throw new Error(`${label} must be a nonempty relative path.`);
    }
    let normalized = declaredPath;
    while (normalized.startsWith("./")) {
        normalized = normalized.slice(2);
    }
    if (!normalized || normalized.startsWith("/") || normalized.includes("\\") || normalized.includes("\0") || normalized.includes(":")) {
        throw new Error(`${label} is unsafe: ${declaredPath}`);
    }
    const segments = normalized.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`${label} is unsafe: ${declaredPath}`);
    }
    return normalized.replace(/\/$/, "");
}

function resolvePackagedMain(packageBase, declaredMain, hasFile) {
    const relativeMain = packageRelativePath(declaredMain, `${packageBase} main`);
    const exact = `${packageBase}/${relativeMain}`;
    const candidates = [
        exact,
        `${exact}.js`,
        `${exact}.json`,
        `${exact}.node`,
        `${exact}/index.js`,
        `${exact}/index.json`,
        `${exact}/index.node`,
    ];
    return candidates.find(hasFile);
}

export function validateProductionDependencies(lockfile, { hasFile, readPackageManifest }) {
    const errors = [];
    let entrypointCount = 0;
    const closure = productionDependencyClosure(lockfile);
    for (const packagePath of closure) {
        const packageBase = `extension/${packagePath}`;
        const manifestPath = `${packageBase}/package.json`;
        if (!hasFile(manifestPath)) {
            errors.push(`required production package manifest is missing: ${manifestPath}`);
            continue;
        }
        let manifest;
        try {
            manifest = readPackageManifest(packagePath);
        } catch (error) {
            errors.push(`cannot parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        const lockedPackage = lockfile.packages[packagePath];
        const packageName = expectedPackageName(packagePath);
        if (manifest.name !== packageName) {
            errors.push(`${manifestPath} name ${manifest.name} does not match ${packageName}`);
        }
        if (manifest.version !== lockedPackage.version) {
            errors.push(`${manifestPath} version ${manifest.version} does not match lockfile ${lockedPackage.version}`);
        }
        if (manifest.main !== undefined) {
            try {
                const resolvedMain = resolvePackagedMain(packageBase, manifest.main, hasFile);
                if (!resolvedMain) {
                    errors.push(`required production package main is missing for ${manifest.name}: ${manifest.main}`);
                } else {
                    entrypointCount += 1;
                }
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }
        const binEntries = typeof manifest.bin === "string"
            ? [manifest.bin]
            : manifest.bin && typeof manifest.bin === "object" && !Array.isArray(manifest.bin)
                ? Object.values(manifest.bin)
                : manifest.bin === undefined
                    ? []
                    : [undefined];
        for (const binEntry of binEntries) {
            try {
                const relativeBin = packageRelativePath(binEntry, `${packageBase} bin`);
                const packagedBin = `${packageBase}/${relativeBin}`;
                if (!hasFile(packagedBin)) {
                    errors.push(`required production package bin is missing: ${packagedBin}`);
                } else {
                    entrypointCount += 1;
                }
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }
    }
    if (errors.length > 0) {
        throw new Error(`Production dependency contract failed:\n- ${errors.join("\n- ")}`);
    }
    return { packageCount: closure.length, entrypointCount };
}

function parseIdentityAttributes(vsixManifestText) {
    const matches = [...vsixManifestText.matchAll(/<Identity\b([^>]*)\/?\s*>/gi)];
    if (matches.length !== 1) {
        throw new Error(`extension.vsixmanifest must contain exactly one Identity element; found ${matches.length}.`);
    }
    const attributes = {};
    const attributePattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const match of matches[0][1].matchAll(attributePattern)) {
        if (Object.prototype.hasOwnProperty.call(attributes, match[1])) {
            throw new Error(`extension.vsixmanifest Identity repeats attribute ${match[1]}.`);
        }
        attributes[match[1]] = match[2] ?? match[3];
    }
    return attributes;
}

export function validateManifestAgreement({ artifactFileName, packagedManifest, repositoryManifest, vsixManifestText }) {
    const errors = [];
    for (const field of ["name", "publisher", "version"]) {
        if (typeof repositoryManifest[field] !== "string" || !repositoryManifest[field]) {
            errors.push(`repository package.json has invalid ${field}`);
        } else if (packagedManifest[field] !== repositoryManifest[field]) {
            errors.push(`packaged package.json ${field} ${packagedManifest[field]} does not match repository ${repositoryManifest[field]}`);
        }
    }
    let identity;
    try {
        identity = parseIdentityAttributes(vsixManifestText);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    if (identity) {
        if (identity.Id !== repositoryManifest.name) {
            errors.push(`VSIX Identity Id ${identity.Id} does not match ${repositoryManifest.name}`);
        }
        if (identity.Publisher !== repositoryManifest.publisher) {
            errors.push(`VSIX Identity Publisher ${identity.Publisher} does not match ${repositoryManifest.publisher}`);
        }
        if (identity.Version !== repositoryManifest.version) {
            errors.push(`VSIX Identity Version ${identity.Version} does not match ${repositoryManifest.version}`);
        }
    }
    const expectedFileName = `${repositoryManifest.name}-${repositoryManifest.version}.vsix`;
    if (artifactFileName !== expectedFileName) {
        errors.push(`VSIX filename ${artifactFileName} does not match ${expectedFileName}`);
    }
    if (errors.length > 0) {
        throw new Error(`VSIX identity contract failed:\n- ${errors.join("\n- ")}`);
    }
}

export function validateNeetCodeSnapshot(repositoryIndexBytes, packagedIndexBytes, entries) {
    if (!packagedIndexBytes.equals(repositoryIndexBytes)) {
        throw new Error("Packaged neetcode-index.json does not exactly match the repository snapshot.");
    }
    let index;
    try {
        index = JSON.parse(packagedIndexBytes.toString("utf8"));
    } catch (error) {
        throw new Error(`Packaged neetcode-index.json is malformed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const expectedContent = new Set(Object.values(index?.problems || {})
        .map((problem) => problem?.contentFile)
        .filter((path) => typeof path === "string")
        .map((path) => `extension/data/${path}`));
    const actualContent = new Set(entries
        .filter((entry) => !entry.name.endsWith("/") && entry.name.toLowerCase().startsWith("extension/data/neetcode-content/"))
        .map((entry) => entry.name));
    const missing = [...expectedContent].filter((path) => !actualContent.has(path));
    const extra = [...actualContent].filter((path) => !expectedContent.has(path));
    if (missing.length > 0 || extra.length > 0) {
        throw new Error(`Packaged NeetCode content does not match the index; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}.`);
    }
    return index;
}

function parseJsonEntry(archive, entryByName, name) {
    const entry = entryByName.get(name);
    if (!entry) {
        throw new Error(`Required JSON entry is missing: ${name}`);
    }
    if (entry.uncompressedSize > MAX_JSON_SIZE) {
        throw new Error(`JSON entry exceeds ${MAX_JSON_SIZE} bytes: ${name}`);
    }
    try {
        return JSON.parse(readZipEntry(archive, entry).toString("utf8"));
    } catch (error) {
        throw new Error(`Cannot parse ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function smokePackagedRuntime(archive, entries) {
    const extractionRoot = await mkdtemp(join(tmpdir(), "leetnotion-vsix-smoke-"));
    try {
        for (const entry of entries) {
            if (entry.name.endsWith("/")) {
                continue;
            }
            const target = resolve(extractionRoot, ...entry.name.split("/"));
            if (!target.startsWith(`${resolve(extractionRoot)}${process.platform === "win32" ? "\\" : "/"}`)) {
                throw new Error(`Refusing to extract outside smoke root: ${entry.name}`);
            }
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, readZipEntry(archive, entry));
        }
        const smokeCode = [
            "const path = require('path');",
            "const root = path.join(process.argv[1], 'extension', 'node_modules');",
            "const load = (name) => require(path.join(root, name));",
            "if (typeof load('bottleneck') !== 'function') throw new Error('bottleneck entrypoint failed');",
            "if (typeof load('ts-fsrs').fsrs !== 'function') throw new Error('ts-fsrs entrypoint failed');",
            "if (typeof load(path.join('vsc-leetcode-cli', 'lib', 'cli.js')).run !== 'function') throw new Error('vsc-leetcode-cli entrypoint failed');",
        ].join(" ");
        await execFileAsync(process.execPath, ["-e", smokeCode, extractionRoot], {
            timeout: 30_000,
            windowsHide: true,
        });
    } finally {
        await rm(extractionRoot, { force: true, recursive: true });
    }
}

async function main() {
    const packageManifestPath = join(repositoryRoot, "package.json");
    const lockfilePath = join(repositoryRoot, "package-lock.json");
    const neetCodeIndexPath = join(repositoryRoot, "data", "neetcode-index.json");
    const [repositoryManifestBytes, lockfileBytes, repositoryIndexBytes] = await Promise.all([
        readFile(packageManifestPath),
        readFile(lockfilePath),
        readFile(neetCodeIndexPath),
    ]);
    const repositoryManifest = JSON.parse(repositoryManifestBytes.toString("utf8"));
    const lockfile = JSON.parse(lockfileBytes.toString("utf8"));
    const repositoryIndex = JSON.parse(repositoryIndexBytes.toString("utf8"));
    const artifactPath = resolve(process.argv[2] || join(repositoryRoot, `${repositoryManifest.name}-${repositoryManifest.version}.vsix`));
    const [archive, artifactStats] = await Promise.all([readFile(artifactPath), stat(artifactPath)]);
    const entries = parseZipEntries(archive);
    const result = validateVsixEntries(entries, {
        requiredPaths: requiredVsixPaths(repositoryIndex),
        vsixSize: artifactStats.size,
    });
    const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
    const packagedManifest = parseJsonEntry(archive, entryByName, "extension/package.json");
    const vsixManifestText = readZipEntry(archive, entryByName.get("extension.vsixmanifest")).toString("utf8");
    validateManifestAgreement({
        artifactFileName: basename(artifactPath),
        packagedManifest,
        repositoryManifest,
        vsixManifestText,
    });
    const packagedIndexBytes = readZipEntry(archive, entryByName.get("extension/data/neetcode-index.json"));
    validateNeetCodeSnapshot(repositoryIndexBytes, packagedIndexBytes, entries);
    const dependencyResult = validateProductionDependencies(lockfile, {
        hasFile: (name) => entryByName.has(name) && !name.endsWith("/"),
        readPackageManifest: (packagePath) => parseJsonEntry(archive, entryByName, `extension/${packagePath}/package.json`),
    });
    await smokePackagedRuntime(archive, entries);
    process.stdout.write(`VSIX verified: ${artifactPath}\n`);
    process.stdout.write(`Files: ${result.fileCount}; unpacked: ${result.unpackedSize} bytes; VSIX: ${result.vsixSize} bytes\n`);
    process.stdout.write(`Runtime closure: ${dependencyResult.packageCount} packages, ${dependencyResult.entrypointCount} declared entrypoints; extracted runtime smoke passed.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
