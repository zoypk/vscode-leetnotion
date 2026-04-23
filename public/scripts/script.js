const vscode = acquireVsCodeApi();
const setPropertiesSection = document.getElementById("setPropertiesSection");
const setPropertiesButton = document.getElementById("setPropertiesButton");
let selectedReviewRating;

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

window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.command) {
        case "submission-done":
            setPropertiesButton.onclick = () => {
                const notesInput = document.getElementById("notes-input");
                const reviewDateInput = document.getElementById("review-date-input");
                const optimalCheckboxInput = document.getElementById("optimal-checkbox-input");
                vscode.postMessage({
                    command: "set-properties",
                    questionNumber: message.questionNumber,
                    questionPageId: message.questionPageId,
                    submissionPageId: message.submissionPageId,
                    notes: notesInput.value,
                    reviewDate: reviewDateInput.value,
                    reviewRating: selectedReviewRating,
                    isOptimal: optimalCheckboxInput.checked,
                    initialTags: message.tags.filter(({ selected }) => selected).map(({ text }) => text),
                    finalTags: $("#tags-select").select2("data").map(({ text }) => text),
                });
            };

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

            $("#tags-select").select2({
                tags: true,
                dropdownParent: $("#tags-box"),
                tokenSeparators: [","],
                data: message.tags,
                maximumSelectionLength: 100,
                placeholder: "Search for an option...",
            });
            setPropertiesSection.style.display = "block";
            break;
    }
});
