import { randomBytes } from "crypto";

const VOID_ELEMENTS: ReadonlySet<string> = new Set([
    "br", "hr", "img",
]);

const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
    "a", "abbr", "b", "blockquote", "br", "code", "del", "details", "div", "em",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "ol",
    "p", "pre", "s", "samp", "small", "span", "strong", "sub", "summary", "sup",
    "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);

const DROP_CONTENT_ELEMENTS: ReadonlySet<string> = new Set([
    "applet", "audio", "button", "canvas", "embed", "form", "frame", "frameset", "iframe",
    "input", "math", "menu", "meta", "noembed", "noframes", "noscript", "object", "option",
    "plaintext", "script", "select", "source", "style", "svg", "template", "textarea", "video",
    "xmp",
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
const NAMED_REFERENCES: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    colon: ":",
    gt: ">",
    lt: "<",
    newline: "\n",
    nbsp: "\u00a0",
    quot: "\"",
    tab: "\t",
};

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
    const output: string[] = [];
    const openElements: string[] = [];
    let position = 0;

    while (position < input.length) {
        const tagStart = input.indexOf("<", position);
        if (tagStart === -1) {
            output.push(escapeHtml(decodeCharacterReferences(input.slice(position))));
            break;
        }
        if (tagStart > position) {
            output.push(escapeHtml(decodeCharacterReferences(input.slice(position, tagStart))));
        }

        if (input.startsWith("<!--", tagStart)) {
            const commentEnd = input.indexOf("-->", tagStart + 4);
            position = commentEnd === -1 ? input.length : commentEnd + 3;
            continue;
        }
        if (input[tagStart + 1] === "!" || input[tagStart + 1] === "?") {
            position = findTagBoundary(input, tagStart + 2);
            continue;
        }

        const tag = readTag(input, tagStart);
        if (!tag) {
            output.push("&lt;");
            position = tagStart + 1;
            continue;
        }
        position = tag.end;

        if (DROP_CONTENT_ELEMENTS.has(tag.name)) {
            if (!tag.closing) {
                position = findDroppedElementEnd(input, position, tag.name);
            }
            continue;
        }
        if (!ALLOWED_ELEMENTS.has(tag.name)) {
            continue;
        }
        if (tag.closing) {
            const matchIndex = openElements.lastIndexOf(tag.name);
            if (matchIndex === -1) {
                continue;
            }
            while (openElements.length > matchIndex) {
                output.push(`</${openElements.pop()}>`);
            }
            continue;
        }

        const attributes = sanitizeAttributes(tag.name, tag.attributes);
        if (tag.name === "img" && !attributes.includes(" src=")) {
            continue;
        }
        output.push(`<${tag.name}${attributes}>`);
        if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name)) {
            openElements.push(tag.name);
        }
    }

    while (openElements.length > 0) {
        output.push(`</${openElements.pop()}>`);
    }
    return output.join("");
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
                while (cursor < input.length && input[cursor] !== quote) {
                    cursor += 1;
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

function findDroppedElementEnd(input: string, start: number, name: string): number {
    const lower = input.toLowerCase();
    const closePrefix = `</${name}`;
    let cursor = start;
    while (cursor < input.length) {
        const closeStart = lower.indexOf(closePrefix, cursor);
        if (closeStart === -1) {
            return input.length;
        }
        const afterName = closeStart + closePrefix.length;
        if (!isNameCharacter(input[afterName])) {
            return findTagBoundary(input, afterName);
        }
        cursor = afterName;
    }
    return input.length;
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
    let output = "";
    let cursor = 0;
    while (cursor < value.length) {
        if (value[cursor] !== "&") {
            output += value[cursor];
            cursor += 1;
            continue;
        }
        const semicolon = value.indexOf(";", cursor + 1);
        if (semicolon === -1 || semicolon - cursor > 32) {
            output += "&";
            cursor += 1;
            continue;
        }
        const reference = value.slice(cursor + 1, semicolon);
        let decoded: string | undefined;
        if (/^#[0-9]+$/.test(reference)) {
            decoded = decodeCodePoint(Number(reference.slice(1)));
        } else if (/^#x[0-9a-f]+$/i.test(reference)) {
            decoded = decodeCodePoint(parseInt(reference.slice(2), 16));
        } else {
            decoded = NAMED_REFERENCES[reference.toLowerCase()];
        }
        if (decoded === undefined) {
            output += value.slice(cursor, semicolon + 1);
        } else {
            output += decoded;
        }
        cursor = semicolon + 1;
    }
    return output;
}

function decodeCodePoint(codePoint: number): string {
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return "\ufffd";
    }
    return String.fromCodePoint(codePoint);
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
