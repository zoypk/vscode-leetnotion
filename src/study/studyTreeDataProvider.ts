import * as vscode from "vscode";
import { StudyNode } from "./studyNode";
import { StudyBacklogItem, StudySection, StudySectionId, StudyTodayItem } from "./types";
import { studyService } from "./studyService";

export class StudyTreeDataProvider implements vscode.TreeDataProvider<StudyNode> {
    private sections: StudySection[] = [];
    private errorMessage?: string;
    private hasLoaded = false;

    private onDidChangeTreeDataEvent: vscode.EventEmitter<StudyNode | undefined | null> = new vscode.EventEmitter<
        StudyNode | undefined | null
    >();
    public readonly onDidChangeTreeData: vscode.Event<StudyNode | undefined | null> = this.onDidChangeTreeDataEvent.event;

    public async refresh(): Promise<void> {
        this.hasLoaded = true;
        try {
            this.sections = studyService.isConfigured() ? await studyService.getSections() : [];
            this.errorMessage = undefined;
        } catch (error) {
            this.sections = [];
            this.errorMessage = error instanceof Error ? error.message : `${error}`;
        }

        this.onDidChangeTreeDataEvent.fire(null);
    }

    public getTreeItem(element: StudyNode): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, element.collapsibleState);
        item.description = element.description;
        item.tooltip = element.tooltip;
        item.command = element.command;

        switch (element.kind) {
            case "setup":
                item.contextValue = "study-setup";
                item.iconPath = new vscode.ThemeIcon("link-external");
                break;
            case "section":
                item.contextValue = "study-section";
                item.iconPath = new vscode.ThemeIcon(this.getSectionIcon(element.sectionId));
                break;
            case "review-problem":
                item.contextValue = "study-review-problem";
                item.iconPath = new vscode.ThemeIcon(element.review?.status === "overdue" ? "warning" : "history");
                break;
            case "new-problem":
                item.contextValue = "study-new-problem";
                item.iconPath = new vscode.ThemeIcon("play-circle");
                break;
            default:
                item.contextValue = "study-message";
                item.iconPath = new vscode.ThemeIcon("info");
                break;
        }

        return item;
    }

    public async getChildren(element?: StudyNode): Promise<StudyNode[]> {
        if (!this.hasLoaded) {
            await this.refresh();
        }

        if (!studyService.isConfigured()) {
            return [
                new StudyNode(
                    "study-setup",
                    "Set workspace folder for local study planning",
                    "setup",
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    "Set `leetnotion.workspaceFolder` to store backlog data in `.leetnotion/study.json`.",
                    undefined,
                    undefined,
                    undefined,
                    {
                        title: "Open Settings",
                        command: "workbench.action.openSettings",
                        arguments: ["leetnotion.workspaceFolder"],
                    },
                ),
            ];
        }

        if (this.errorMessage) {
            return [
                new StudyNode(
                    "study-error",
                    "Unable to load study view",
                    "message",
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    this.errorMessage,
                ),
            ];
        }

        if (!element) {
            return this.sections.map((section) => new StudyNode(
                `study-${section.id}`,
                section.label,
                "section",
                vscode.TreeItemCollapsibleState.Expanded,
                section.description,
                this.getSectionTooltip(section),
                section.id,
            ));
        }

        if (element.kind !== "section") {
            return [];
        }

        const section = this.sections.find((item) => item.id === element.sectionId);
        if (!section || section.items.length === 0) {
            return [
                new StudyNode(
                    `${element.id}-empty`,
                    section?.emptyLabel ?? "No study items",
                    "message",
                    vscode.TreeItemCollapsibleState.None,
                ),
            ];
        }

        switch (section.id) {
            case StudySectionId.Today:
                return (section.items as StudyTodayItem[]).map((item) => item.kind === "review"
                    ? new StudyNode(
                        item.id,
                        `[${item.review.questionNumber}] ${item.review.name}`,
                        "review-problem",
                        vscode.TreeItemCollapsibleState.None,
                        this.getTodayReviewDescription(item.review),
                        this.getTodayReviewTooltip(item.review),
                        section.id,
                        item.review,
                        undefined,
                        {
                            title: "Preview Problem",
                            command: "leetnotion.previewStudyProblem",
                            arguments: [item.review],
                        },
                    )
                    : new StudyNode(
                        item.id,
                        `[${item.questionNumber}] ${item.name}`,
                        "new-problem",
                        vscode.TreeItemCollapsibleState.None,
                        this.getBacklogDescription(item),
                        this.getBacklogTooltip(item, true),
                        section.id,
                        undefined,
                        item,
                        {
                            title: "Preview Problem",
                            command: "leetnotion.previewStudyProblem",
                            arguments: [item],
                        },
                    ));
            case StudySectionId.Backlog:
                return (section.items as StudyBacklogItem[]).map((item) => new StudyNode(
                    item.id,
                    `[${item.questionNumber}] ${item.name}`,
                    "new-problem",
                    vscode.TreeItemCollapsibleState.None,
                    this.getBacklogDescription(item),
                    this.getBacklogTooltip(item),
                    section.id,
                    undefined,
                    item,
                    {
                        title: "Preview Problem",
                        command: "leetnotion.previewStudyProblem",
                        arguments: [item],
                    },
                ));
            case StudySectionId.Filters:
                return (section.items as string[]).map((message, index) => new StudyNode(
                    `${element.id}-${index}`,
                    message,
                    "message",
                    vscode.TreeItemCollapsibleState.None,
                ));
            default:
                return [];
        }
    }

    private getSectionIcon(sectionId?: StudySectionId): string {
        switch (sectionId) {
            case StudySectionId.Today:
                return "calendar";
            case StudySectionId.Backlog:
                return "list-unordered";
            case StudySectionId.Filters:
                return "filter";
            default:
                return "book";
        }
    }

    private getSectionTooltip(section: StudySection): string {
        if (section.id === StudySectionId.Today) {
            return "Due reviews followed by today's planned new backlog problems";
        }

        if (section.id === StudySectionId.Backlog) {
            return "Pending new problems waiting to be pulled into today's plan";
        }

        return "Active study filters and daily planning settings";
    }

    private getTodayReviewDescription(review: NonNullable<StudyNode["review"]>): string {
        if (review.status === "overdue") {
            return `${review.overdueDays}d overdue`;
        }

        return review.status === "due-today" ? "Review" : review.reviewDate;
    }

    private getTodayReviewTooltip(review: NonNullable<StudyNode["review"]>): string {
        return [
            "Review item",
            `Difficulty: ${review.difficulty || "Unknown"}`,
            `Next review: ${review.reviewDate}`,
            review.lastRating ? `Last rating: ${review.lastRating}` : undefined,
        ].filter((line): line is string => Boolean(line)).join("\n");
    }

    private getBacklogDescription(item: StudyBacklogItem): string {
        if (item.plannedForToday) {
            return "Today";
        }

        if (this.isDeferred(item)) {
            return `Deferred to ${item.deferredUntil}`;
        }

        return item.matchesActiveFilters ? "Ready" : "Filtered out";
    }

    private getBacklogTooltip(item: StudyBacklogItem, plannedForToday: boolean = false): string {
        return [
            plannedForToday ? "Today's new problem" : "Backlog problem",
            `Difficulty: ${item.difficulty || "Unknown"}`,
            item.sheets.length > 0 ? `Sheets: ${item.sheets.join(", ")}` : "Sheets: None",
            item.tags.length > 0 ? `Topics: ${item.tags.join(", ")}` : "Topics: None",
            `Matches active filters: ${item.matchesActiveFilters ? "Yes" : "No"}`,
        ].join("\n");
    }

    private isDeferred(item: StudyBacklogItem): boolean {
        if (!item.deferredUntil) {
            return false;
        }

        const today = new Date();
        const dayKey = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, "0")}-${`${today.getDate()}`.padStart(2, "0")}`;
        return item.deferredUntil > dayKey;
    }
}

export const studyTreeDataProvider: StudyTreeDataProvider = new StudyTreeDataProvider();
