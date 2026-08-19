import { StudyTodayItem } from "./types";

export function selectNextStudySessionItem(
    items: StudyTodayItem[],
    excludedQuestionNumber?: string,
): StudyTodayItem | undefined {
    if (!excludedQuestionNumber) {
        return items[0];
    }
    return items.find((item) => getQuestionNumber(item) !== excludedQuestionNumber);
}

function getQuestionNumber(item: StudyTodayItem): string {
    return item.kind === "review" ? item.review.questionNumber : item.questionNumber;
}
