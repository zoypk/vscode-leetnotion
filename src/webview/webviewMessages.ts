export interface WebviewMessageSchema {
    readonly [action: string]: readonly string[];
}

export interface ParsedWebviewMessage {
    readonly action: string;
    readonly values: Readonly<Record<string, string>>;
}

const DEFAULT_MAX_MESSAGE_LENGTH = 16 * 1024;
const DEFAULT_MAX_FIELD_LENGTH = 512;

export function parseWebviewMessage(
    input: unknown,
    schema: WebviewMessageSchema,
    actionField: "action" | "command" = "action",
    maxMessageLength: number = DEFAULT_MAX_MESSAGE_LENGTH,
): ParsedWebviewMessage | undefined {
    if (!isPlainRecord(input)) {
        return undefined;
    }
    const action = input[actionField];
    if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(schema, action)) {
        return undefined;
    }
    const expectedFields = schema[action];
    const allowedKeys = new Set([actionField, ...expectedFields]);
    const inputKeys = Object.keys(input);
    if (inputKeys.some((key) => !allowedKeys.has(key)) || inputKeys.length !== allowedKeys.size) {
        return undefined;
    }

    let measuredLength = action.length + actionField.length;
    const values: Record<string, string> = {};
    for (const field of expectedFields) {
        const value = input[field];
        if (typeof value !== "string" || value.length === 0 || value.length > DEFAULT_MAX_FIELD_LENGTH) {
            return undefined;
        }
        measuredLength += field.length + value.length;
        if (measuredLength > maxMessageLength) {
            return undefined;
        }
        values[field] = value;
    }
    return { action, values };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
