import { randomBytes } from "crypto";
import MarkdownIt from "markdown-it";

const VOID_ELEMENTS: ReadonlySet<string> = new Set([
    "br", "hr", "img",
]);

const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
    "a", "abbr", "b", "blockquote", "br", "code", "del", "details", "div", "em",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "ol",
    "p", "pre", "s", "samp", "small", "span", "strong", "sub", "summary", "sup",
    "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);

const DROP_CONTENT_CONTAINERS: ReadonlySet<string> = new Set([
    "applet", "audio", "button", "canvas", "form", "frameset", "iframe", "math", "menu",
    "noembed", "noframes", "noscript", "object", "option", "plaintext", "script", "select",
    "style", "svg", "template", "textarea", "video", "xmp",
]);

const RAW_TEXT_CONTAINERS: ReadonlySet<string> = new Set([
    "iframe", "noembed", "noframes", "noscript", "plaintext", "script", "style", "textarea", "xmp",
]);

const FORBIDDEN_VOID_ELEMENTS: ReadonlySet<string> = new Set([
    "area", "base", "col", "embed", "frame", "input", "link", "meta", "param", "source", "track",
]);

const GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set(["class", "title"]);
const ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
    a: new Set(["href"]),
    blockquote: new Set(["cite"]),
    details: new Set(["open"]),
    img: new Set(["alt", "height", "loading", "src", "width"]),
    li: new Set(["value"]),
    ol: new Set(["reversed", "start", "type"]),
    td: new Set(["colspan", "rowspan"]),
    th: new Set(["colspan", "rowspan", "scope"]),
};

const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set(["open", "reversed"]);
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(["cite", "href", "src"]);
const ENTITY_REFERENCE = /&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi;
const decodeMarkdownEntity = new MarkdownIt().utils.unescapeAll;

interface HtmlAttribute {
    name: string;
    value: string;
}

interface HtmlTag {
    attributes: HtmlAttribute[];
    closing: boolean;
    end: number;
    name: string;
    selfClosing: boolean;
}

export interface SanitizerLimits {
    /** Maximum UTF-16 input units examined by one sanitization call. */
    readonly maxInputLength: number;
    /** Maximum UTF-16 units emitted, including balancing close tags. */
    readonly maxOutputLength: number;
    /** Maximum simultaneously open allowed elements. */
    readonly maxNestingDepth: number;
    /** Maximum text, tag, comment, and declaration tokens processed. */
    readonly maxTokens: number;
}

export type SanitizerLimitReason = "input" | "nesting" | "output" | "tokens";

export interface SanitizerDiagnostics {
    readonly charactersScanned: number;
    readonly inputLength: number;
    readonly limits: SanitizerLimits;
    readonly maxObservedNesting: number;
    readonly outputLength: number;
    readonly reasons: readonly SanitizerLimitReason[];
    readonly stackOperations: number;
    readonly tokensProcessed: number;
    readonly truncated: boolean;
}

export interface SanitizedHtmlResult {
    readonly diagnostics: SanitizerDiagnostics;
    readonly html: string;
}

export const DEFAULT_SANITIZER_LIMITS: SanitizerLimits = Object.freeze({
    maxInputLength: 2_000_000,
    maxNestingDepth: 128,
    maxOutputLength: 2_000_000,
    maxTokens: 200_000,
});

export function escapeHtml(value: unknown): string {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function escapeAttribute(value: unknown): string {
    return escapeHtml(value).replace(/`/g, "&#96;");
}

export function serializeJsonForHtml(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        return "null";
    }
    return serialized
        .replace(/&/g, "\\u0026")
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

export function createNonce(): string {
    return randomBytes(18).toString("base64");
}

export function createWebviewCsp(webviewSource: string, nonce: string): string {
    const source = normalizeCspSource(webviewSource);
    const safeNonce = nonce.replace(/[^A-Za-z0-9+/_=-]/g, "");
    if (!source || !safeNonce) {
        throw new Error("A valid webview source and nonce are required");
    }
    return [
        "default-src 'none'",
        `img-src https: ${source}`,
        `font-src ${source}`,
        `style-src ${source} 'nonce-${safeNonce}'`,
        `script-src ${source} 'nonce-${safeNonce}'`,
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-src 'none'",
    ].join("; ") + ";";
}

export function allowWebviewUrl(rawValue: string): string | undefined {
    const decoded = decodeCharacterReferences(rawValue).trim();
    if (!decoded || /[\u0000-\u001f\u007f]/.test(decoded) || decoded.includes("\\")) {
        return undefined;
    }
    if (decoded.startsWith("#")) {
        return /^#[^\s\"'<>`\\]*$/.test(decoded) ? decoded : undefined;
    }
    if (!/^https:\/\//i.test(decoded) || decoded.startsWith("//")) {
        return undefined;
    }
    try {
        const parsed = new URL(decoded);
        return parsed.protocol === "https:" ? parsed.href : undefined;
    } catch (_error) {
        return undefined;
    }
}

export function sanitizeHtml(input: string): string {
    return sanitizeHtmlWithDiagnostics(input).html;
}

export function sanitizeHtmlWithDiagnostics(
    input: string,
    requestedLimits: Partial<SanitizerLimits> = {},
): SanitizedHtmlResult {
    const limits = normalizeSanitizerLimits(requestedLimits);
    const source = input.slice(0, limits.maxInputLength);
    const output: string[] = [];
    const openElements: string[] = [];
    const openPositions: Map<string, number[]> = new Map();
    const reasons: Set<SanitizerLimitReason> = new Set();
    let position = 0;
    let outputLength = 0;
    let closingBudget = 0;
    let tokensProcessed = 0;
    let stackOperations = 0;
    let maxObservedNesting = 0;
    let dropScanCharacters = 0;
    let stopped = false;

    if (source.length < input.length) {
        reasons.add("input");
    }

    const consumeToken = (): boolean => {
        if (tokensProcessed >= limits.maxTokens) {
            reasons.add("tokens");
            stopped = true;
            return false;
        }
        tokensProcessed += 1;
        return true;
    };

    const appendChunk = (chunk: string, additionalReserve: number = 0): boolean => {
        if (outputLength + chunk.length + closingBudget + additionalReserve > limits.maxOutputLength) {
            reasons.add("output");
            stopped = true;
            return false;
        }
        output.push(chunk);
        outputLength += chunk.length;
        return true;
    };

    const appendText = (text: string): boolean => {
        const available = limits.maxOutputLength - outputLength - closingBudget;
        const escaped = escapeTextWithinLimit(decodeCharacterReferences(text), available);
        if (escaped.value) {
            output.push(escaped.value);
            outputLength += escaped.value.length;
        }
        if (escaped.truncated) {
            reasons.add("output");
            stopped = true;
            return false;
        }
        return true;
    };

    const popOpenElement = (): void => {
        const name = openElements.pop();
        if (!name) {
            return;
        }
        const closeTag = `</${name}>`;
        closingBudget -= closeTag.length;
        output.push(closeTag);
        outputLength += closeTag.length;
        const openElementPositions = openPositions.get(name)!;
        openElementPositions.pop();
        if (openElementPositions.length === 0) {
            openPositions.delete(name);
        }
        stackOperations += 1;
    };

    while (position < source.length && !stopped) {
        const tagStart = source.indexOf("<", position);
        if (tagStart === -1) {
            if (consumeToken()) {
                appendText(source.slice(position));
            }
            position = source.length;
            break;
        }
        if (tagStart > position) {
            if (!consumeToken() || !appendText(source.slice(position, tagStart))) {
                position = tagStart;
                break;
            }
        }
        if (!consumeToken()) {
            position = tagStart;
            break;
        }

        if (source.startsWith("<!--", tagStart)) {
            const commentEnd = source.indexOf("-->", tagStart + 4);
            position = commentEnd === -1 ? source.length : commentEnd + 3;
            continue;
        }
        if (source[tagStart + 1] === "!" || source[tagStart + 1] === "?") {
            position = findTagBoundary(source, tagStart + 2);
            continue;
        }

        const tag = readTag(source, tagStart);
        if (!tag) {
            appendChunk("&lt;");
            position = tagStart + 1;
            continue;
        }
        position = tag.end;

        if (FORBIDDEN_VOID_ELEMENTS.has(tag.name)) {
            continue;
        }
        if (DROP_CONTENT_CONTAINERS.has(tag.name)) {
            if (!tag.closing && !tag.selfClosing) {
                const dropped = findDroppedElementEnd(
                    source,
                    position,
                    tag.name,
                    RAW_TEXT_CONTAINERS.has(tag.name),
                );
                position = dropped.end;
                dropScanCharacters += dropped.scanned;
            }
            continue;
        }
        if (!ALLOWED_ELEMENTS.has(tag.name)) {
            continue;
        }
        if (tag.closing) {
            const closingPositions = openPositions.get(tag.name);
            if (!closingPositions || closingPositions.length === 0) {
                continue;
            }
            const matchIndex = closingPositions[closingPositions.length - 1];
            while (openElements.length > matchIndex) {
                popOpenElement();
            }
            continue;
        }

        const attributes = sanitizeAttributes(tag.name, tag.attributes);
        if (tag.name === "img" && !attributes.includes(" src=")) {
            continue;
        }
        const openTag = `<${tag.name}${attributes}>`;
        if (VOID_ELEMENTS.has(tag.name)) {
            appendChunk(openTag);
            continue;
        }
        const closeTag = `</${tag.name}>`;
        if (tag.selfClosing) {
            appendChunk(openTag + closeTag);
            continue;
        }
        if (openElements.length >= limits.maxNestingDepth) {
            reasons.add("nesting");
            continue;
        }
        if (!appendChunk(openTag, closeTag.length)) {
            continue;
        }
        const openingPositions = openPositions.get(tag.name) || [];
        openingPositions.push(openElements.length);
        openPositions.set(tag.name, openingPositions);
        openElements.push(tag.name);
        closingBudget += closeTag.length;
        stackOperations += 1;
        maxObservedNesting = Math.max(maxObservedNesting, openElements.length);
    }

    while (openElements.length > 0) {
        popOpenElement();
    }
    const html = output.join("");
    return {
        html,
        diagnostics: {
            charactersScanned: Math.min(position, source.length) + dropScanCharacters,
            inputLength: input.length,
            limits,
            maxObservedNesting,
            outputLength: html.length,
            reasons: Array.from(reasons).sort() as SanitizerLimitReason[],
            stackOperations,
            tokensProcessed,
            truncated: reasons.size > 0,
        },
    };
}

function sanitizeAttributes(element: string, attributes: HtmlAttribute[]): string {
    const output: string[] = [];
    const seen: Set<string> = new Set();
    const elementAttributes = ELEMENT_ATTRIBUTES[element] || new Set<string>();

    for (const attribute of attributes) {
        const name = attribute.name.toLowerCase();
        if (seen.has(name) || name === "id" || name === "style" || name === "srcset" || name.startsWith("on")) {
            continue;
        }
        seen.add(name);
        if (!GLOBAL_ATTRIBUTES.has(name) && !elementAttributes.has(name)) {
            continue;
        }
        if (BOOLEAN_ATTRIBUTES.has(name)) {
            output.push(` ${name}`);
            continue;
        }

        let value = decodeCharacterReferences(attribute.value).replace(/\u0000/g, "");
        if (URL_ATTRIBUTES.has(name)) {
            const safeUrl = allowWebviewUrl(value);
            if (!safeUrl) {
                continue;
            }
            value = safeUrl;
        } else if (name === "class") {
            value = value.split(/\s+/).filter((part) => /^[A-Za-z0-9_-]+$/.test(part)).join(" ");
            if (!value) {
                continue;
            }
        } else if ((name === "width" || name === "height" || name === "colspan" || name === "rowspan" || name === "start" || name === "value")
            && !/^-?\d{1,6}$/.test(value)) {
            continue;
        } else if (name === "loading" && value !== "lazy" && value !== "eager") {
            continue;
        } else if (name === "scope" && !/^(?:col|row|colgroup|rowgroup)$/.test(value)) {
            continue;
        } else if (name === "type" && !/^(?:1|a|A|i|I)$/.test(value)) {
            continue;
        }
        output.push(` ${name}="${escapeAttribute(value)}"`);
    }
    return output.join("");
}

function readTag(input: string, start: number): HtmlTag | undefined {
    let cursor = start + 1;
    let closing = false;
    if (input[cursor] === "/") {
        closing = true;
        cursor += 1;
    }
    while (isWhitespace(input[cursor])) {
        cursor += 1;
    }
    const nameStart = cursor;
    while (isNameCharacter(input[cursor])) {
        cursor += 1;
    }
    if (cursor === nameStart) {
        return undefined;
    }
    const name = input.slice(nameStart, cursor).toLowerCase();
    const attributes: HtmlAttribute[] = [];
    let selfClosing = false;

    while (cursor < input.length) {
        while (isWhitespace(input[cursor])) {
            cursor += 1;
        }
        if (input[cursor] === ">") {
            return { attributes, closing, end: cursor + 1, name, selfClosing };
        }
        if (input[cursor] === "/" && input[cursor + 1] === ">") {
            selfClosing = true;
            return { attributes, closing, end: cursor + 2, name, selfClosing };
        }
        if (closing) {
            return undefined;
        }

        const attributeStart = cursor;
        while (cursor < input.length && !isWhitespace(input[cursor]) && !/[=/>]/.test(input[cursor])) {
            cursor += 1;
        }
        if (cursor === attributeStart) {
            cursor += 1;
            continue;
        }
        const attributeName = input.slice(attributeStart, cursor).toLowerCase();
        while (isWhitespace(input[cursor])) {
            cursor += 1;
        }
        let value = "";
        if (input[cursor] === "=") {
            cursor += 1;
            while (isWhitespace(input[cursor])) {
                cursor += 1;
            }
            const quote = input[cursor] === "\"" || input[cursor] === "'" ? input[cursor] : undefined;
            if (quote) {
                cursor += 1;
                const valueStart = cursor;
                while (cursor < input.length && input[cursor] !== quote && input[cursor] !== ">") {
                    cursor += 1;
                }
                if (input[cursor] === ">") {
                    return { attributes, closing, end: cursor + 1, name, selfClosing };
                }
                if (cursor >= input.length) {
                    return undefined;
                }
                value = input.slice(valueStart, cursor);
                cursor += 1;
            } else {
                const valueStart = cursor;
                while (cursor < input.length && !isWhitespace(input[cursor]) && !/[>]/.test(input[cursor])) {
                    cursor += 1;
                }
                value = input.slice(valueStart, cursor);
            }
        }
        attributes.push({ name: attributeName, value });
    }
    return undefined;
}

function findDroppedElementEnd(
    input: string,
    start: number,
    name: string,
    rawText: boolean,
): { end: number; scanned: number } {
    if (name === "plaintext") {
        return { end: input.length, scanned: input.length - start };
    }
    let cursor = start;
    let depth = 1;
    while (cursor < input.length) {
        const tagStart = input.indexOf("<", cursor);
        if (tagStart === -1) {
            return { end: input.length, scanned: input.length - start };
        }
        const tag = readTag(input, tagStart);
        if (!tag) {
            cursor = tagStart + 1;
            continue;
        }
        cursor = tag.end;
        if (tag.name !== name) {
            continue;
        }
        if (tag.closing) {
            depth -= 1;
            if (depth === 0 || rawText) {
                return { end: tag.end, scanned: tag.end - start };
            }
        } else if (!rawText && !tag.selfClosing) {
            depth += 1;
        }
    }
    return { end: input.length, scanned: input.length - start };
}

function findTagBoundary(input: string, start: number): number {
    let cursor = start;
    let quote: string | undefined;
    while (cursor < input.length) {
        const character = input[cursor];
        if (quote) {
            if (character === quote) {
                quote = undefined;
            }
        } else if (character === "\"" || character === "'") {
            quote = character;
        } else if (character === ">") {
            return cursor + 1;
        }
        cursor += 1;
    }
    return input.length;
}

function decodeCharacterReferences(value: string): string {
    return value.replace(ENTITY_REFERENCE, (reference) => decodeMarkdownEntity(reference));
}

function escapeTextWithinLimit(value: string, limit: number): { truncated: boolean; value: string } {
    if (limit <= 0) {
        return { truncated: value.length > 0, value: "" };
    }
    const chunks: string[] = [];
    let length = 0;
    for (const character of value) {
        const escaped = character === "&" ? "&amp;"
            : character === "<" ? "&lt;"
            : character === ">" ? "&gt;"
            : character === "\"" ? "&quot;"
            : character === "'" ? "&#39;"
            : character;
        if (length + escaped.length > limit) {
            return { truncated: true, value: chunks.join("") };
        }
        chunks.push(escaped);
        length += escaped.length;
    }
    return { truncated: false, value: chunks.join("") };
}

function normalizeSanitizerLimits(requested: Partial<SanitizerLimits>): SanitizerLimits {
    return {
        maxInputLength: normalizeLimit(requested.maxInputLength, DEFAULT_SANITIZER_LIMITS.maxInputLength),
        maxNestingDepth: normalizeLimit(requested.maxNestingDepth, DEFAULT_SANITIZER_LIMITS.maxNestingDepth),
        maxOutputLength: normalizeLimit(requested.maxOutputLength, DEFAULT_SANITIZER_LIMITS.maxOutputLength),
        maxTokens: normalizeLimit(requested.maxTokens, DEFAULT_SANITIZER_LIMITS.maxTokens),
    };
}

function normalizeLimit(requested: number | undefined, maximum: number): number {
    if (requested === undefined || !Number.isFinite(requested)) {
        return maximum;
    }
    return Math.max(1, Math.min(maximum, Math.floor(requested)));
}

function isWhitespace(character: string | undefined): boolean {
    return character !== undefined && /[\t\n\f\r ]/.test(character);
}

function isNameCharacter(character: string | undefined): boolean {
    return character !== undefined && /[A-Za-z0-9:-]/.test(character);
}

function normalizeCspSource(source: string): string | undefined {
    const trimmed = source.trim();
    if (!trimmed || /[;\s\"']/.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}
