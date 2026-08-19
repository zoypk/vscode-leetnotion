const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {
    constructor(id, dataset = {}) {
        this.id = id;
        this.dataset = dataset;
        this.value = "";
        this.checked = false;
        this.disabled = false;
        this.tabIndex = -1;
        this.textContent = "";
        this.listeners = new Map();
        this.attributes = new Map();
        this.classes = new Set();
        this.classList = {
            toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
        };
        this.style = { display: "" };
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
        for (const listener of this.listeners.get(type) || []) {
            listener({ preventDefault: () => { event.prevented = true; }, ...event });
        }
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name);
    }

    focus() {
        this.focused = true;
    }
}

function createHarness() {
    const ids = [
        "setPropertiesSection", "setPropertiesButton", "leetcode-properties-section", "notion-properties-section",
        "review-date-input", "review-clear-button", "notes-input", "submission-flag-select",
        "optimal-checkbox-input", "tags-select", "submission-properties-status", "review-hint",
    ];
    const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
    const ratings = ["again", "hard", "good", "easy"].map((rating) => new FakeElement(`rating-${rating}`, { rating }));
    const flags = ["WHITE", "RED", "BLUE"].map((flagValue) => new FakeElement(`flag-${flagValue}`, { flagValue }));
    flags[0].tabIndex = 0;
    const config = new FakeElement("submission-form-state");
    config.textContent = JSON.stringify({
        state: { notes: "old", flagType: "WHITE", isOptimal: true, tags: ["A"], reviewDate: "2026-08-20" },
        hasLeetCodeProperties: true,
        hasNotionProperties: true,
        tagOptions: ["A", "B"],
    });
    elements[config.id] = config;

    const messages = [];
    const windowListeners = new Map();
    let selectData = [];
    const jquery = () => {
        const api = {
            off: () => api,
            empty: () => { selectData = []; return api; },
            select2: (arg) => {
                if (arg === "data") return selectData;
                if (arg === "destroy") return api;
                if (arg && Array.isArray(arg.data)) {
                    selectData = arg.data.filter(({ selected }) => selected).map(({ id, text }) => ({ id, text }));
                }
                return api;
            },
        };
        return api;
    };
    const window = {
        $: jquery,
        addEventListener: (type, listener) => windowListeners.set(type, listener),
    };
    const document = {
        getElementById: (id) => elements[id] || null,
        querySelectorAll: (selector) => selector === ".review-rating-button" ? ratings
            : selector === ".submission-flag-swatch" ? flags : [],
    };
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "public", "scripts", "script.js"), "utf8");
    vm.runInNewContext(source, {
        acquireVsCodeApi: () => ({ postMessage: (message) => messages.push(message) }),
        document,
        window,
        $: jquery,
        console,
        JSON,
        Set,
        Array,
    });
    return {
        elements,
        flags,
        messages,
        ratings,
        getSelectData: () => selectData,
        receive: (message) => windowListeners.get("message")({ data: message }),
    };
}

test("production handlers enforce symmetric review controls and aria-pressed", () => {
    const harness = createHarness();
    harness.elements["review-date-input"].value = "2026-08-31";
    harness.elements["review-date-input"].dispatch("input");
    harness.ratings[2].dispatch("click");
    assert.equal(harness.elements["review-date-input"].value, "");
    assert.equal(harness.ratings[2].getAttribute("aria-pressed"), "true");

    harness.elements["review-date-input"].value = "2026-09-01";
    harness.elements["review-date-input"].dispatch("input");
    assert.equal(harness.ratings[2].getAttribute("aria-pressed"), "false");
    harness.elements["setPropertiesButton"].dispatch("click");
    assert.equal(JSON.stringify(harness.messages.at(-1).review), JSON.stringify({ kind: "date", value: "2026-09-01" }));
});

test("production roving radios wrap, select, and move focus", () => {
    const harness = createHarness();
    harness.flags[0].dispatch("keydown", { key: "ArrowLeft" });
    assert.equal(harness.elements["submission-flag-select"].value, "BLUE");
    assert.equal(harness.flags[2].tabIndex, 0);
    assert.equal(harness.flags[2].focused, true);
    assert.equal(harness.flags[2].getAttribute("aria-checked"), "true");
});

test("failed save preserves drafts while success installs authoritative fields and tags", () => {
    const harness = createHarness();
    harness.elements["notes-input"].value = "unsaved draft";
    harness.ratings[1].dispatch("click");
    harness.elements["setPropertiesButton"].dispatch("click");
    harness.receive({ command: "submission-properties-save-failed", error: "network failed" });
    assert.equal(harness.elements["notes-input"].value, "unsaved draft");
    assert.equal(harness.ratings[1].getAttribute("aria-pressed"), "true");

    harness.receive({
        command: "submission-properties-saved",
        message: "Saved.",
        hasNotionProperties: true,
        tagOptions: ["A", "B"],
        state: { notes: "server", flagType: "RED", isOptimal: false, tags: ["B"], reviewDate: "2026-09-09" },
    });
    assert.equal(harness.elements["notes-input"].value, "server");
    assert.equal(harness.elements["submission-flag-select"].value, "RED");
    assert.equal(harness.elements["optimal-checkbox-input"].checked, false);
    assert.deepEqual(harness.getSelectData().map(({ text }) => text), ["B"]);
    assert.equal(harness.ratings[1].getAttribute("aria-pressed"), "false");
    assert.equal(harness.elements["review-date-input"].value, "");

    harness.receive({
        command: "submission-properties-saved",
        hasNotionProperties: true,
        tagOptions: ["A", "B"],
        state: { notes: "server", flagType: "RED", isOptimal: false, tags: ["A"], reviewDate: "2026-09-09" },
    });
    assert.deepEqual(harness.getSelectData().map(({ text }) => text), ["A"]);
});
