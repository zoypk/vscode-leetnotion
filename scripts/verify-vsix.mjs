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
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});

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
    "extension/.git/",
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
    "extension/.git",
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
            crc32: buffer.readUInt32LE(offset + 16),
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
        if (/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM(?:[1-9]|[¹²³])|LPT(?:[1-9]|[¹²³]))$/.test(deviceStem)) {
            throw new Error(`archive path contains a reserved Windows device name: ${name}`);
        }
    }
    if (entry.isSymlink) {
        throw new Error(`symbolic links are forbidden in the VSIX: ${name}`);
    }
    return {
        canonical: segments.map((segment) => segment.toUpperCase()).join("/"),
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
    for (const entry of entries.filter((candidate) => candidate.name.endsWith("/"))) {
        if ((entry.compressedSize ?? 0) !== 0 || (entry.uncompressedSize ?? 0) !== 0 || (entry.crc32 ?? 0) !== 0) {
            errors.push(`directory ZIP entry must be empty: ${entry.name}`);
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

export function calculateCrc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export async function readBoundedVsix(artifactPath, { statFile = stat, readFileBytes = readFile } = {}) {
    const artifactStats = await statFile(artifactPath);
    if (!Number.isSafeInteger(artifactStats.size) || artifactStats.size < 0 || artifactStats.size > VSIX_SIZE_LIMIT) {
        throw new Error(`VSIX size ${artifactStats.size} exceeds ${VSIX_SIZE_LIMIT} bytes or is invalid.`);
    }
    const archive = await readFileBytes(artifactPath);
    if (archive.length !== artifactStats.size) {
        throw new Error(`VSIX changed size while being read: expected ${artifactStats.size}, read ${archive.length}.`);
    }
    return { archive, artifactStats };
}

export function readZipEntry(archive, entry) {
    if (!entry) {
        throw new Error("Cannot read a missing ZIP entry.");
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
    if ((flags & 8) === 0) {
        const localCrc32 = archive.readUInt32LE(offset + 14);
        const localCompressedSize = archive.readUInt32LE(offset + 18);
        const localUncompressedSize = archive.readUInt32LE(offset + 22);
        if (localCrc32 !== entry.crc32
            || localCompressedSize !== entry.compressedSize
            || localUncompressedSize !== entry.uncompressedSize) {
            throw new Error(`Central and local ZIP integrity fields disagree for ${entry.name}.`);
        }
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
    if (calculateCrc32(content) !== entry.crc32) {
        throw new Error(`CRC-32 mismatch for ${entry.name}.`);
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

function requiredDependencyMap(packageRecord) {
    const dependencies = packageRecord?.dependencies || {};
    const optionalDependencies = packageRecord?.optionalDependencies || {};
    return Object.fromEntries(Object.entries(dependencies)
        .filter(([name]) => !Object.prototype.hasOwnProperty.call(optionalDependencies, name)));
}

export function productionDependencyClosure(lockfile) {
    const packages = lockfile?.packages;
    const root = packages?.[""];
    if (!packages || !root || !root.dependencies || typeof root.dependencies !== "object") {
        throw new Error("package-lock.json is missing the root production dependency map.");
    }
    const queue = Object.keys(requiredDependencyMap(root)).map((name) => resolveLockedDependency(packages, "", name));
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
        for (const dependencyName of Object.keys(requiredDependencyMap(lockedPackage))) {
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

function manifestObjectMap(value, label, errors) {
    if (value === undefined) {
        return {};
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${label} must be an object`);
        return {};
    }
    return value;
}

function reconcileDependencyMaps(declared, locked, label, errors) {
    const declaredNames = Object.keys(declared);
    const lockedNames = Object.keys(locked || {});
    for (const dependencyName of new Set([...declaredNames, ...lockedNames])) {
        if (!Object.prototype.hasOwnProperty.call(declared, dependencyName)) {
            errors.push(`${label} omits locked production dependency ${dependencyName}`);
        } else if (!Object.prototype.hasOwnProperty.call(locked || {}, dependencyName)) {
            errors.push(`${label} declares unlocked production dependency ${dependencyName}`);
        } else if (declared[dependencyName] !== locked[dependencyName]) {
            errors.push(`${label} dependency ${dependencyName} uses ${declared[dependencyName]}, lockfile uses ${locked[dependencyName]}`);
        }
    }
}

export function validateProductionDependencies(lockfile, { hasFile, readPackageManifest, rootManifest }) {
    const errors = [];
    let entrypointCount = 0;
    const closure = productionDependencyClosure(lockfile);
    const lockClosure = new Set(closure);
    const manifestsByPath = new Map();
    const manifestRequiredByPath = new Map();
    const rootDeclaredDependencies = manifestObjectMap(rootManifest?.dependencies, "packaged root package.json dependencies", errors);
    const rootDeclaredOptional = manifestObjectMap(rootManifest?.optionalDependencies, "packaged root package.json optionalDependencies", errors);
    const rootLockedDependencies = lockfile.packages[""].dependencies || {};
    const rootLockedOptional = lockfile.packages[""].optionalDependencies || {};
    reconcileDependencyMaps(rootDeclaredDependencies, rootLockedDependencies, "packaged root package.json dependencies", errors);
    reconcileDependencyMaps(rootDeclaredOptional, rootLockedOptional, "packaged root package.json optionalDependencies", errors);
    const rootDependencies = requiredDependencyMap({ dependencies: rootDeclaredDependencies, optionalDependencies: rootDeclaredOptional });
    reconcileDependencyMaps(rootDependencies, requiredDependencyMap(lockfile.packages[""]), "packaged root package.json required dependencies", errors);
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
        manifestsByPath.set(packagePath, manifest);
        const lockedPackage = lockfile.packages[packagePath];
        const packageName = expectedPackageName(packagePath);
        if (manifest.name !== packageName) {
            errors.push(`${manifestPath} name ${manifest.name} does not match ${packageName}`);
        }
        if (manifest.version !== lockedPackage.version) {
            errors.push(`${manifestPath} version ${manifest.version} does not match lockfile ${lockedPackage.version}`);
        }
        const manifestDependencies = manifestObjectMap(manifest.dependencies, `${manifestPath} dependencies`, errors);
        const manifestOptional = manifestObjectMap(manifest.optionalDependencies, `${manifestPath} optionalDependencies`, errors);
        reconcileDependencyMaps(manifestDependencies, lockedPackage.dependencies || {}, `${manifestPath} dependencies`, errors);
        reconcileDependencyMaps(manifestOptional, lockedPackage.optionalDependencies || {}, `${manifestPath} optionalDependencies`, errors);
        const manifestRequired = requiredDependencyMap({ dependencies: manifestDependencies, optionalDependencies: manifestOptional });
        reconcileDependencyMaps(manifestRequired, requiredDependencyMap(lockedPackage), `${manifestPath} required dependencies`, errors);
        manifestRequiredByPath.set(packagePath, manifestRequired);
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
    const manifestQueue = [];
    for (const dependencyName of Object.keys(rootDependencies)) {
        try {
            manifestQueue.push(resolveLockedDependency(lockfile.packages, "", dependencyName));
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    const manifestClosure = new Set();
    while (manifestQueue.length > 0) {
        const packagePath = manifestQueue.shift();
        if (manifestClosure.has(packagePath)) {
            continue;
        }
        manifestClosure.add(packagePath);
        const manifest = manifestsByPath.get(packagePath);
        if (!manifest) {
            continue;
        }
        for (const dependencyName of Object.keys(manifestRequiredByPath.get(packagePath) || {})) {
            try {
                manifestQueue.push(resolveLockedDependency(lockfile.packages, packagePath, dependencyName));
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }
    }
    for (const packagePath of lockClosure) {
        if (!manifestClosure.has(packagePath)) {
            errors.push(`packaged manifest dependency graph does not reach locked production package ${packagePath}`);
        }
    }
    for (const packagePath of manifestClosure) {
        if (!lockClosure.has(packagePath)) {
            errors.push(`packaged manifest dependency graph reaches unlocked production package ${packagePath}`);
        }
    }
    if (errors.length > 0) {
        throw new Error(`Production dependency contract failed:\n- ${errors.join("\n- ")}`);
    }
    return { packageCount: closure.length, entrypointCount };
}

function decodeXmlAttribute(value) {
    const entityPattern = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi;
    let result = "";
    let cursor = 0;
    for (const match of value.matchAll(entityPattern)) {
        if (value.slice(cursor, match.index).includes("&")) {
            throw new Error("extension.vsixmanifest contains an unknown XML entity.");
        }
        result += value.slice(cursor, match.index);
        const entity = match[0];
        const named = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }[entity.toLowerCase()];
        if (named !== undefined) {
            result += named;
        } else {
            const codePoint = entity[2].toLowerCase() === "x"
                ? Number.parseInt(entity.slice(3, -1), 16)
                : Number.parseInt(entity.slice(2, -1), 10);
            if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
                throw new Error("extension.vsixmanifest contains an invalid numeric XML entity.");
            }
            result += String.fromCodePoint(codePoint);
        }
        cursor = match.index + entity.length;
    }
    if (value.slice(cursor).includes("&")) {
        throw new Error("extension.vsixmanifest contains an unknown XML entity.");
    }
    return result + value.slice(cursor);
}

function findXmlTagEnd(xml, start) {
    let quote = "";
    for (let index = start; index < xml.length; index += 1) {
        const character = xml[index];
        if (quote) {
            if (character === quote) {
                quote = "";
            }
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === ">") {
            return index;
        } else if (character === "<") {
            throw new Error("extension.vsixmanifest contains a nested '<' inside a tag.");
        }
    }
    throw new Error("extension.vsixmanifest contains an unterminated tag.");
}

function parseXmlStartTag(rawTag) {
    let source = rawTag.trim();
    const selfClosing = source.endsWith("/");
    if (selfClosing) {
        source = source.slice(0, -1).trimEnd();
    }
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source);
    if (!nameMatch) {
        throw new Error("extension.vsixmanifest contains an invalid element name.");
    }
    const name = nameMatch[0];
    const attributes = {};
    let cursor = name.length;
    while (cursor < source.length) {
        const whitespace = /^\s+/.exec(source.slice(cursor));
        if (!whitespace) {
            throw new Error(`extension.vsixmanifest has malformed attributes on ${name}.`);
        }
        cursor += whitespace[0].length;
        if (cursor === source.length) {
            break;
        }
        const attributeMatch = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(source.slice(cursor));
        if (!attributeMatch) {
            throw new Error(`extension.vsixmanifest has an invalid attribute on ${name}.`);
        }
        const attributeName = attributeMatch[0];
        cursor += attributeName.length;
        cursor += /^\s*/.exec(source.slice(cursor))[0].length;
        if (source[cursor] !== "=") {
            throw new Error(`extension.vsixmanifest attribute ${attributeName} is missing '='.`);
        }
        cursor += 1;
        cursor += /^\s*/.exec(source.slice(cursor))[0].length;
        const quote = source[cursor];
        if (quote !== '"' && quote !== "'") {
            throw new Error(`extension.vsixmanifest attribute ${attributeName} is not quoted.`);
        }
        const valueEnd = source.indexOf(quote, cursor + 1);
        if (valueEnd < 0) {
            throw new Error(`extension.vsixmanifest attribute ${attributeName} is unterminated.`);
        }
        if (Object.prototype.hasOwnProperty.call(attributes, attributeName)) {
            throw new Error(`extension.vsixmanifest repeats attribute ${attributeName}.`);
        }
        attributes[attributeName] = decodeXmlAttribute(source.slice(cursor + 1, valueEnd));
        cursor = valueEnd + 1;
    }
    return { attributes, name, selfClosing };
}

function parseIdentityAttributes(vsixManifestText) {
    const stack = [];
    const identities = [];
    let metadataCount = 0;
    let rootName = "";
    let cursor = 0;
    while (cursor < vsixManifestText.length) {
        const tagStart = vsixManifestText.indexOf("<", cursor);
        if (tagStart < 0) {
            break;
        }
        if (stack.length === 0 && vsixManifestText.slice(cursor, tagStart).trim()) {
            throw new Error("extension.vsixmanifest contains text outside its root element.");
        }
        if (vsixManifestText.startsWith("<!--", tagStart)) {
            const commentEnd = vsixManifestText.indexOf("-->", tagStart + 4);
            if (commentEnd < 0) {
                throw new Error("extension.vsixmanifest contains an unterminated comment.");
            }
            cursor = commentEnd + 3;
            continue;
        }
        if (vsixManifestText.startsWith("<![CDATA[", tagStart)) {
            if (stack.length === 0) {
                throw new Error("extension.vsixmanifest contains CDATA outside its root element.");
            }
            const cdataEnd = vsixManifestText.indexOf("]]>", tagStart + 9);
            if (cdataEnd < 0) {
                throw new Error("extension.vsixmanifest contains unterminated CDATA.");
            }
            cursor = cdataEnd + 3;
            continue;
        }
        if (vsixManifestText.startsWith("<?", tagStart)) {
            const instructionEnd = vsixManifestText.indexOf("?>", tagStart + 2);
            if (instructionEnd < 0) {
                throw new Error("extension.vsixmanifest contains an unterminated processing instruction.");
            }
            cursor = instructionEnd + 2;
            continue;
        }
        if (vsixManifestText.startsWith("<!", tagStart)) {
            throw new Error("extension.vsixmanifest declarations such as DOCTYPE are forbidden.");
        }
        const tagEnd = findXmlTagEnd(vsixManifestText, tagStart + 1);
        const rawTag = vsixManifestText.slice(tagStart + 1, tagEnd);
        if (rawTag.startsWith("/")) {
            const closingName = rawTag.slice(1).trim();
            if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(closingName) || stack.pop() !== closingName) {
                throw new Error(`extension.vsixmanifest has a mismatched closing tag ${closingName}.`);
            }
        } else {
            const tag = parseXmlStartTag(rawTag);
            if (stack.length === 0) {
                if (rootName) {
                    throw new Error("extension.vsixmanifest contains multiple root elements.");
                }
                rootName = tag.name;
            }
            const localName = tag.name.split(":").pop();
            const ancestry = stack.map((name) => name.split(":").pop());
            if (localName === "Metadata") {
                if (ancestry.length !== 1 || ancestry[0] !== "PackageManifest") {
                    throw new Error("extension.vsixmanifest Metadata must be a direct child of PackageManifest.");
                }
                metadataCount += 1;
            }
            if (localName === "Identity") {
                if (ancestry.length !== 2 || ancestry[0] !== "PackageManifest" || ancestry[1] !== "Metadata") {
                    throw new Error("extension.vsixmanifest Identity must have exact PackageManifest/Metadata/Identity ancestry.");
                }
                identities.push(tag.attributes);
            }
            if (!tag.selfClosing) {
                stack.push(tag.name);
            }
        }
        cursor = tagEnd + 1;
    }
    if (stack.length === 0 && vsixManifestText.slice(cursor).trim()) {
        throw new Error("extension.vsixmanifest contains text outside its root element.");
    }
    if (stack.length > 0) {
        throw new Error(`extension.vsixmanifest has an unclosed element ${stack.at(-1)}.`);
    }
    if (rootName.split(":").pop() !== "PackageManifest") {
        throw new Error("extension.vsixmanifest root element must be PackageManifest.");
    }
    if (metadataCount !== 1) {
        throw new Error(`extension.vsixmanifest must contain exactly one direct Metadata element; found ${metadataCount}.`);
    }
    if (identities.length !== 1) {
        throw new Error(`extension.vsixmanifest must contain exactly one Identity element; found ${identities.length}.`);
    }
    return identities[0];
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
            const target = resolve(extractionRoot, ...entry.name.split("/"));
            if (!target.startsWith(`${resolve(extractionRoot)}${process.platform === "win32" ? "\\" : "/"}`)) {
                throw new Error(`Refusing to extract outside smoke root: ${entry.name}`);
            }
            const content = readZipEntry(archive, entry);
            if (entry.name.endsWith("/")) {
                await mkdir(target, { recursive: true });
                continue;
            }
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, content);
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
    const { archive, artifactStats } = await readBoundedVsix(artifactPath);
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
        rootManifest: packagedManifest,
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
