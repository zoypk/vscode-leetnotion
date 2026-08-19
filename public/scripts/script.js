const vscode = acquireVsCodeApi();
const configElement = document.getElementById("submission-form-state");
const initialConfig = (() => {
    try {
        return JSON.parse(configElement?.textContent || "{}");
    } catch (_error) {
        return {};
    }
})();

const elements = {
    section: document.getElementById("setPropertiesSection"),
    button: document.getElementById("setPropertiesButton"),
    leetcode: document.getElementById("leetcode-properties-section"),
    notion: document.getElementById("notion-properties-section"),
    reviewDate: document.getElementById("review-date-input"),
    reviewClear: document.getElementById("review-clear-button"),
    reviewButtons: Array.from(document.querySelectorAll(".review-rating-button")),
    notes: document.getElementById("notes-input"),
    flagInput: document.getElementById("submission-flag-select"),
    flagButtons: Array.from(document.querySelectorAll(".submission-flag-swatch")),
    optimal: document.getElementById("optimal-checkbox-input"),
    tags: document.getElementById("tags-select"),
    status: document.getElementById("submission-properties-status"),
};

let savedState = normalizeState(initialConfig.state);
let reviewEdit = { kind: "unchanged" };
let selectedReviewRating;
let hasLeetCodeProperties = Boolean(initialConfig.hasLeetCodeProperties);
let hasNotionProperties = Boolean(initialConfig.hasNotionProperties);
let tagOptions = normalizeTags(initialConfig.tagOptions);
let tagsInitialized = false;
let saving = false;

function normalizeState(value) {
    return {
        notes: typeof value?.notes === "string" ? value.notes : "",
        flagType: typeof value?.flagType === "string" ? value.flagType : "WHITE",
        isOptimal: Boolean(value?.isOptimal),
        tags: normalizeTags(value?.tags),
        reviewDate: typeof value?.reviewDate === "string" ? value.reviewDate : null,
    };
}

function normalizeTags(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim());
}

function setStatus(message, isError = false) {
    if (!elements.status) return;
    elements.status.textContent = message || "";
    elements.status.classList.toggle("error", isError);
}

function setSaving(value) {
    saving = value;
    if (!elements.button) return;
    elements.button.disabled = saving;
    elements.button.textContent = saving
        ? "Saving..."
        : hasLeetCodeProperties && hasNotionProperties
            ? "Save LeetCode note, review, and Notion properties"
            : hasLeetCodeProperties
                ? "Save LeetCode note and review"
                : "Save Notion properties";
}

function updateVisibility() {
    if (elements.section) elements.section.style.display = hasLeetCodeProperties || hasNotionProperties ? "block" : "none";
    if (elements.leetcode) elements.leetcode.style.display = hasLeetCodeProperties ? "flex" : "none";
    if (elements.notion) elements.notion.style.display = hasNotionProperties ? "flex" : "none";
}

function setReviewEdit(edit) {
    reviewEdit = edit;
    selectedReviewRating = edit.kind === "rating" ? edit.value : undefined;
    if (elements.reviewDate && edit.kind !== "date") elements.reviewDate.value = "";
    elements.reviewButtons.forEach((button) => {
        const selected = button.dataset.rating === selectedReviewRating;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
    });
    const hint = document.getElementById("review-hint");
    if (!hint) return;
    if (edit.kind === "rating") {
        hint.textContent = `FSRS will schedule the next review from ${edit.value.charAt(0).toUpperCase()}${edit.value.slice(1)}.`;
    } else if (edit.kind === "date") {
        hint.textContent = `Next review will be scheduled for ${edit.value}.`;
    } else if (edit.kind === "clear") {
        hint.textContent = "The review schedule will be cleared.";
    } else {
        hint.textContent = savedState.reviewDate
            ? `Current review date is ${savedState.reviewDate}. Choose a replacement or clear it.`
            : "Pick a calendar date or let FSRS schedule from a rating.";
    }
}

function setFlag(value, focus = false) {
    if (elements.flagInput) elements.flagInput.value = value;
    elements.flagButtons.forEach((button) => {
        const selected = button.dataset.flagValue === value;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-checked", String(selected));
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
    });
}

function moveFlag(button, key) {
    const current = elements.flagButtons.indexOf(button);
    if (current < 0 || elements.flagButtons.length === 0) return;
    let next = current;
    if (key === "ArrowLeft" || key === "ArrowUp") next = (current - 1 + elements.flagButtons.length) % elements.flagButtons.length;
    else if (key === "ArrowRight" || key === "ArrowDown") next = (current + 1) % elements.flagButtons.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = elements.flagButtons.length - 1;
    else return;
    setFlag(elements.flagButtons[next].dataset.flagValue || "WHITE", true);
}

function initializeTags(selectedTags) {
    if (!hasNotionProperties || !elements.tags || typeof window.$ !== "function") return;
    const selected = new Set(selectedTags);
    const options = Array.from(new Set([...tagOptions, ...selectedTags]));
    tagOptions = options;
    if (tagsInitialized) $(elements.tags).off().select2("destroy");
    $(elements.tags).empty().select2({
        tags: true,
        dropdownParent: $("#tags-box"),
        tokenSeparators: [","],
        data: options.map((text, index) => ({ id: index + 1, text, selected: selected.has(text) })),
        maximumSelectionLength: 100,
        placeholder: "Search for an option...",
        width: "100%",
    });
    tagsInitialized = true;
}

function selectedTags() {
    if (!tagsInitialized || typeof window.$ !== "function") return [...savedState.tags];
    return $(elements.tags).select2("data").map(({ text }) => text.trim()).filter(Boolean);
}

function installSavedState(nextState) {
    savedState = normalizeState(nextState);
    if (elements.notes) elements.notes.value = savedState.notes;
    if (elements.optimal) elements.optimal.checked = savedState.isOptimal;
    setFlag(savedState.flagType);
    initializeTags(savedState.tags);
    if (elements.reviewDate) elements.reviewDate.value = "";
    setReviewEdit({ kind: "unchanged" });
}

function saveProperties() {
    if (saving) return;
    setSaving(true);
    setStatus("Saving...");
    vscode.postMessage({
        command: "set-properties",
        notes: elements.notes?.value || "",
        flagType: elements.flagInput?.value || "WHITE",
        review: reviewEdit,
        isOptimal: Boolean(elements.optimal?.checked),
        tags: selectedTags(),
    });
}

elements.reviewDate?.addEventListener("input", () => {
    setReviewEdit(elements.reviewDate.value
        ? { kind: "date", value: elements.reviewDate.value }
        : { kind: "unchanged" });
});
elements.reviewButtons.forEach((button) => button.addEventListener("click", () => {
    setReviewEdit({ kind: "rating", value: button.dataset.rating });
}));
elements.reviewClear?.addEventListener("click", () => setReviewEdit({ kind: "clear" }));
elements.flagButtons.forEach((button) => {
    button.addEventListener("click", () => setFlag(button.dataset.flagValue || "WHITE"));
    button.addEventListener("keydown", (event) => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            moveFlag(button, event.key);
        }
    });
});
elements.button?.addEventListener("click", saveProperties);

updateVisibility();
installSavedState(savedState);
setSaving(false);

window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message.command !== "string") return;
    if (message.command === "submission-form-state") {
        hasNotionProperties = Boolean(message.hasNotionProperties);
        tagOptions = normalizeTags(message.tagOptions);
        updateVisibility();
        installSavedState(message.state);
        setSaving(false);
    } else if (message.command === "submission-properties-saved") {
        hasNotionProperties = Boolean(message.hasNotionProperties);
        tagOptions = normalizeTags(message.tagOptions);
        updateVisibility();
        installSavedState(message.state);
        setSaving(false);
        setStatus(message.message || "Saved.");
    } else if (message.command === "submission-properties-save-failed") {
        setSaving(false);
        setStatus(message.error || "Failed to save properties.", true);
    }
});
