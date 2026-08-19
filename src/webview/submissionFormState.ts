import type { AuthoritativeSubmissionState } from "../notion/submissionProperties";
import type { ReviewEdit } from "./submissionMessages";
import { escapeAttribute, escapeHtml } from "./webviewSecurity";

export interface SubmissionFormState extends AuthoritativeSubmissionState {
    review: ReviewEdit;
    reviewDateInput: string;
    selectedRating?: "again" | "hard" | "good" | "easy";
}

export interface SubmissionFormRenderOptions {
    configJson: string;
    flagOptions: { value: string; label: string }[];
    nonce: string;
    scriptUri: string;
    selectedFlagType: string;
    toolkitUri: string;
}

export function createSubmissionFormState(saved: AuthoritativeSubmissionState): SubmissionFormState {
    return {
        ...saved,
        tags: [...saved.tags],
        review: { kind: "unchanged" },
        reviewDateInput: "",
        selectedRating: undefined,
    };
}

export function chooseReviewDate(state: SubmissionFormState, value: string): SubmissionFormState {
    return {
        ...state,
        review: value ? { kind: "date", value } : { kind: "unchanged" },
        reviewDateInput: value,
        selectedRating: undefined,
    };
}

export function chooseReviewRating(
    state: SubmissionFormState,
    value: "again" | "hard" | "good" | "easy",
): SubmissionFormState {
    return {
        ...state,
        review: { kind: "rating", value },
        reviewDateInput: "",
        selectedRating: value,
    };
}

export function applySavedSubmissionState(
    _state: SubmissionFormState,
    saved: AuthoritativeSubmissionState,
): SubmissionFormState {
    return createSubmissionFormState(saved);
}

export function moveRadioIndex(current: number, key: string, count: number): number {
    if (count <= 0) {
        return current;
    }
    if (key === "ArrowLeft" || key === "ArrowUp") {
        return (current - 1 + count) % count;
    }
    if (key === "ArrowRight" || key === "ArrowDown") {
        return (current + 1) % count;
    }
    if (key === "Home") {
        return 0;
    }
    if (key === "End") {
        return count - 1;
    }
    return current;
}

export function matchesSubmissionContext(
    active: { submissionId: number; questionNumber: string } | undefined,
    incoming: { submissionId: number; questionNumber: string },
): boolean {
    return Boolean(active
        && active.submissionId === incoming.submissionId
        && active.questionNumber === incoming.questionNumber);
}

export function renderSubmissionFormHtml(options: SubmissionFormRenderOptions): string {
    const selectedIndex = Math.max(0, options.flagOptions.findIndex(({ value }) => value === options.selectedFlagType));
    const swatches = options.flagOptions.map((option, index) => {
        const selected = index === selectedIndex;
        return `<button type="button" class="submission-flag-swatch${selected ? " selected" : ""}" data-flag-value="${escapeAttribute(option.value)}" role="radio" aria-checked="${selected}" aria-label="${escapeAttribute(option.label)}" title="${escapeAttribute(option.label)}" tabindex="${selected ? "0" : "-1"}"><span class="submission-flag-swatch-check" aria-hidden="true">&#10003;</span></button>`;
    }).join("");

    return `<section id="setPropertiesSection" aria-labelledby="submission-properties-heading">
        <h2 id="submission-properties-heading">Submission properties</h2>
        <div id="setPropertiesInputSection">
            <div id="leetcode-properties-section">
                <fieldset id="review-container">
                    <legend>Review schedule</legend>
                    <div id="review-inputs">
                        <label for="review-date-input">Review date</label>
                        <input type="date" id="review-date-input" value="" />
                        <div id="review-rating-buttons" role="group" aria-label="FSRS review rating">
                            ${renderRatingButton("again", "Again", "Missed the answer. Schedule the card again soon.")}
                            ${renderRatingButton("hard", "Hard", "Remembered with difficulty. Schedule it a bit sooner.")}
                            ${renderRatingButton("good", "Good", "Remembered normally. Use the standard FSRS interval.")}
                            ${renderRatingButton("easy", "Easy", "Remembered effortlessly. Stretch the next interval.")}
                        </div>
                        <button type="button" id="review-clear-button">Clear review schedule</button>
                        <p id="review-hint">Pick a calendar date or let FSRS schedule from a rating.</p>
                    </div>
                </fieldset>
                <label id="notes-label" for="notes-input">LeetCode note</label>
                <textarea cols="8" rows="6" id="notes-input" maxlength="20000"></textarea>
                <details id="submission-flag-disclosure">
                    <summary>LeetCode color</summary>
                    <div id="submission-flag-swatches" role="radiogroup" aria-label="LeetCode color">${swatches}</div>
                    <input type="hidden" id="submission-flag-select" value="${escapeAttribute(options.selectedFlagType)}" />
                </details>
            </div>
            <div id="notion-properties-section">
                <label><input type="checkbox" id="optimal-checkbox-input" /> Optimal solution</label>
                <label id="tags-label" for="tags-select">Tags</label>
                <div id="tags-box"><select class="form-control" multiple id="tags-select"></select></div>
            </div>
            <p id="submission-properties-status" role="status" aria-live="polite" aria-atomic="true"></p>
            <button type="button" id="setPropertiesButton">Save</button>
        </div>
    </section>
    <script type="application/json" id="submission-form-state">${options.configJson}</script>
    <script nonce="${escapeAttribute(options.nonce)}" src="${escapeAttribute(options.scriptUri)}"></script>
    <script nonce="${escapeAttribute(options.nonce)}" type="module" src="${escapeAttribute(options.toolkitUri)}"></script>`;
}

function renderRatingButton(value: string, label: string, title: string): string {
    return `<button type="button" class="review-rating-button" data-rating="${escapeAttribute(value)}" aria-pressed="false" title="${escapeAttribute(title)}">${escapeHtml(label)}</button>`;
}
