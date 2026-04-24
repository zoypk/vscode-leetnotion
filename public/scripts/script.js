const vscode = acquireVsCodeApi();
const setPropertiesSection = document.getElementById("setPropertiesSection");
const setPropertiesButton = document.getElementById("setPropertiesButton");
const leetcodePropertiesSection = document.getElementById("leetcode-properties-section");
const notionPropertiesSection = document.getElementById("notion-properties-section");
const notesInput = document.getElementById("notes-input");
const submissionFlagInput = document.getElementById("submission-flag-select");
const submissionFlagSwatches = Array.from(document.querySelectorAll(".submission-flag-swatch"));
let selectedReviewRating;
let submissionData = window.__LEETNOTION_SUBMISSION_CONTEXT__ || null;
let notionData = null;
let tagsInitialized = false;
const submissionFlagStyles = window.__LEETNOTION_SUBMISSION_FLAG_STYLES__ || {};

function setSelectedReviewRating(rating) {
    selectedReviewRating = rating;
    document.querySelectorAll(".review-rating-button").forEach((button) => {
        button.classList.toggle("selected", button.dataset.rating === rating);
    });

    const reviewHint = document.getElementById("review-hint");
    if (!reviewHint) {
        return;
    }

    reviewHint.textContent = rating
        ? `FSRS will schedule the next review from ${rating.charAt(0).toUpperCase()}${rating.slice(1)}.`
        : "Pick a calendar date or let FSRS schedule from a rating.";
}

function getDefaultFlagType() {
    return submissionData?.flagType || "WHITE";
}

function getFlagStyle(value) {
    return submissionFlagStyles[value] || submissionFlagStyles.WHITE || { label: value, accent: "#9ca3af", background: "rgba(148, 163, 184, 0.16)", foreground: "#ffffff" };
}

function updateSubmissionFlagSwatches() {
    if (!submissionFlagInput) {
        return;
    }

    const currentValue = submissionFlagInput.value || getDefaultFlagType();
    submissionFlagSwatches.forEach((button) => {
        const value = button.dataset.flagValue || "WHITE";
        const style = getFlagStyle(value);
        const selected = value === currentValue;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-checked", String(selected));
        button.style.setProperty("--submission-flag-accent", style.accent);
        button.style.setProperty("--submission-flag-background", style.background || style.accent);
        button.style.setProperty("--submission-flag-foreground", style.foreground || "#ffffff");
    });
}

function setSubmissionFlagValue(value) {
    if (!submissionFlagInput) {
        return;
    }

    submissionFlagInput.value = value;
    updateSubmissionFlagSwatches();
}

function setSubmissionPropertiesStatus(message, isError = false) {
    const status = document.getElementById("submission-properties-status");
    if (!status) {
        return;
    }

    status.textContent = message || "";
    status.classList.toggle("error", Boolean(isError));
}

function setSavingState(isSaving) {
    if (!setPropertiesButton) {
        return;
    }

    const hasSubmissionProperties = Boolean(submissionData);
    const hasNotionProperties = Boolean(notionData);

    setPropertiesButton.disabled = isSaving;
    setPropertiesButton.textContent = isSaving
        ? "Saving..."
        : hasSubmissionProperties && hasNotionProperties
            ? "Save LeetCode Note + Notion Properties"
            : hasSubmissionProperties
                ? "Save to LeetCode"
                : "Set Properties";
}

function ensureSectionVisible() {
    if (!setPropertiesSection) {
        return;
    }

    if (submissionData || notionData) {
        setPropertiesSection.style.display = "block";
    }
}

function initializeSubmissionFields() {
    if (!submissionData) {
        if (leetcodePropertiesSection) {
            leetcodePropertiesSection.style.display = "none";
        }
        return;
    }

    if (leetcodePropertiesSection) {
        leetcodePropertiesSection.style.display = "flex";
    }

    if (notesInput) {
        notesInput.value = submissionData.notes || "";
    }

    if (submissionFlagInput) {
        submissionFlagInput.value = submissionData.flagType || "WHITE";
    }

    submissionFlagSwatches.forEach((button) => {
        button.onclick = () => setSubmissionFlagValue(button.dataset.flagValue || "WHITE");
    });

    updateSubmissionFlagSwatches();
    ensureSectionVisible();
}

function initializeNotionFields(message) {
    notionData = message;

    setSelectedReviewRating(undefined);
    const reviewDateInput = document.getElementById("review-date-input");
    reviewDateInput.value = "";
    reviewDateInput.oninput = () => {
        if (reviewDateInput.value) {
            setSelectedReviewRating(undefined);
        }
    };
    document.querySelectorAll(".review-rating-button").forEach((button) => {
        button.onclick = () => setSelectedReviewRating(button.dataset.rating);
    });

    if (tagsInitialized) {
        $("#tags-select").off().select2("destroy");
    }
    $("#tags-select").select2({
        tags: true,
        dropdownParent: $("#tags-box"),
        tokenSeparators: [","],
        data: message.tags,
        maximumSelectionLength: 100,
        placeholder: "Search for an option...",
    });
    tagsInitialized = true;

    if (notionPropertiesSection) {
        notionPropertiesSection.style.display = "flex";
    }
    ensureSectionVisible();
}

function initializeNotionSectionVisibility() {
    if (!notionPropertiesSection) {
        return;
    }

    notionPropertiesSection.style.display = notionData ? "flex" : "none";
}

function getInitialTags() {
    if (!notionData?.tags) {
        return [];
    }

    return notionData.tags.filter(({ selected }) => selected).map(({ text }) => text);
}

function getFinalTags() {
    if (!notionData?.tags) {
        return [];
    }

    if (!tagsInitialized) {
        return getInitialTags();
    }

    return $("#tags-select").select2("data").map(({ text }) => text);
}

function saveProperties() {
    const reviewDateInput = document.getElementById("review-date-input");
    const optimalCheckboxInput = document.getElementById("optimal-checkbox-input");

    setSavingState(true);
    setSubmissionPropertiesStatus("Saving...", false);

    vscode.postMessage({
        command: "set-properties",
        questionNumber: notionData?.questionNumber || submissionData?.questionNumber || "",
        questionPageId: notionData?.questionPageId || "",
        submissionPageId: notionData?.submissionPageId || "",
        notes: notesInput?.value || "",
        flagType: submissionFlagInput?.value || getDefaultFlagType(),
        reviewDate: reviewDateInput?.value || "",
        reviewRating: selectedReviewRating,
        isOptimal: optimalCheckboxInput?.checked || false,
        initialTags: getInitialTags(),
        finalTags: getFinalTags(),
    });
}

if (setPropertiesButton) {
    setPropertiesButton.onclick = saveProperties;
}

initializeSubmissionFields();
initializeNotionSectionVisibility();
setSavingState(false);

window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.command) {
        case "submission-done":
            initializeNotionFields(message);
            setSavingState(false);
            break;
        case "submission-properties-saved":
            if (message.notes !== undefined && submissionData) {
                submissionData.notes = message.notes;
            }
            if (message.flagType !== undefined && submissionData) {
                submissionData.flagType = message.flagType;
                if (submissionFlagInput) {
                    submissionFlagInput.value = message.flagType;
                }
                updateSubmissionFlagSwatches();
            }
            setSavingState(false);
            setSubmissionPropertiesStatus(message.message || "Saved.", false);
            break;
        case "submission-properties-save-failed":
            setSavingState(false);
            setSubmissionPropertiesStatus(message.error || "Failed to save properties.", true);
            break;
    }
});
