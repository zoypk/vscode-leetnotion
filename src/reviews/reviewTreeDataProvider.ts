import * as vscode from "vscode";
import { ReviewNode } from "./reviewNode";
import { ReviewSection, ReviewSectionId } from "./types";
import { reviewService } from "./reviewService";

export class ReviewTreeDataProvider implements vscode.TreeDataProvider<ReviewNode> {
    private sections: ReviewSection[] = [];
    private errorMessage?: string;
    private hasLoaded = false;

    private onDidChangeTreeDataEvent: vscode.EventEmitter<ReviewNode | undefined | null> = new vscode.EventEmitter<
        ReviewNode | undefined | null
    >();
    public readonly onDidChangeTreeData: vscode.Event<ReviewNode | undefined | null> = this.onDidChangeTreeDataEvent.event;

    public async refresh(): Promise<void> {
        this.hasLoaded = true;
        try {
            this.sections = reviewService.isConfigured() ? await reviewService.getSections() : [];
            this.errorMessage = undefined;
        } catch (error) {
            this.sections = [];
            this.errorMessage = error instanceof Error ? error.message : `${error}`;
        }

        this.onDidChangeTreeDataEvent.fire(null);
    }

    public getTreeItem(element: ReviewNode): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, element.collapsibleState);
        item.description = element.description;
        item.tooltip = element.tooltip;
        item.command = element.command;

        switch (element.kind) {
            case "setup":
                item.contextValue = "review-setup";
                item.iconPath = new vscode.ThemeIcon("link-external");
                break;
            case "section":
                item.contextValue = "review-section";
                item.iconPath = new vscode.ThemeIcon(element.sectionId === ReviewSectionId.Due ? "history" : "calendar");
                break;
            case "problem":
                item.contextValue = "review-problem";
                item.iconPath = new vscode.ThemeIcon(this.getProblemIcon(element));
                break;
            default:
                item.contextValue = "review-message";
                item.iconPath = new vscode.ThemeIcon("info");
                break;
        }

        return item;
    }

    public async getChildren(element?: ReviewNode): Promise<ReviewNode[]> {
        if (!this.hasLoaded) {
            await this.refresh();
        }

        if (!reviewService.isConfigured()) {
            return [
                new ReviewNode(
                    "reviews-setup",
                    "Set workspace folder for local reviews",
                    "setup",
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    "Set `leetnotion.workspaceFolder` to store reviews in `.leetnotion/reviews.json`.",
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
                new ReviewNode(
                    "reviews-error",
                    "Unable to load reviews",
                    "message",
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    this.errorMessage,
                ),
            ];
        }

        if (!element) {
            const rootNodes: ReviewNode[] = [];
            for (const section of this.sections) {
                rootNodes.push(new ReviewNode(
                    `reviews-${section.id}`,
                    section.label,
                    "section",
                    vscode.TreeItemCollapsibleState.Expanded,
                    this.getSectionDescription(section),
                    this.getSectionTooltip(section),
                    undefined,
                    section.id,
                ));
            }
            return rootNodes;
        }

        if (element.kind !== "section") {
            return [];
        }

        const sectionGroup = this.sections.find(item => item.id === element.sectionId);
        if (!sectionGroup || sectionGroup.items.length === 0) {
            return [
                new ReviewNode(
                    `${element.id}-empty`,
                    sectionGroup?.emptyLabel ?? "No reviews",
                    "message",
                    vscode.TreeItemCollapsibleState.None,
                ),
            ];
        }

        return sectionGroup.items.map(review => new ReviewNode(
            review.id,
            `[${review.questionNumber}] ${review.name}`,
            "problem",
            vscode.TreeItemCollapsibleState.None,
            this.getProblemDescription(review),
            [
                `Difficulty: ${review.difficulty || "Unknown"}`,
                `Next Review: ${this.formatDueDate(review.dueAt)}`,
                `Status: ${this.getProblemStatusLabel(review)}`,
                `Interval: ${this.formatInterval(review.scheduledDays)}`,
                `Stability: ${review.stability.toFixed(2)}`,
                `Memory Difficulty: ${review.memoryDifficulty.toFixed(2)}`,
                `Retrievability: ${(review.retrievability * 100).toFixed(1)}%`,
                `Reviews: ${review.reps} | Lapses: ${review.lapses}`,
                review.lastRating ? `Last Rating: ${this.formatRating(review.lastRating)}` : undefined,
            ].join("\n"),
            review,
            sectionGroup.id,
            {
                title: "Preview Problem",
                command: "leetnotion.previewReviewProblem",
                arguments: [review],
            },
        ));
    }

    private getProblemIcon(element: ReviewNode): string {
        if (element.review?.status === "overdue") {
            return "warning";
        }

        if (element.review?.status === "due-today") {
            return "history";
        }

        return "calendar";
    }

    private getSectionDescription(section: ReviewSection): string {
        const filterSuffix = this.getFilterSuffix();
        if (section.id === ReviewSectionId.Due && section.overdueCount > 0) {
            return `${section.items.length} (${section.overdueCount} overdue)${filterSuffix}`;
        }

        return `${section.items.length}${filterSuffix}`;
    }

    private getSectionTooltip(section: ReviewSection): string {
        const filterTooltip = this.getFilterTooltip();
        if (section.id === ReviewSectionId.Due) {
            return `${section.items.length} due review${section.items.length === 1 ? "" : "s"}${section.overdueCount > 0 ? `\n${section.overdueCount} overdue` : ""}${filterTooltip}`;
        }

        return `${section.items.length} upcoming review${section.items.length === 1 ? "" : "s"}${filterTooltip}`;
    }

    private getProblemDescription(review: ReviewNode["review"]): string {
        if (!review) {
            return "";
        }

        if (review.status === "overdue") {
            return `${review.overdueDays}d overdue`;
        }

        if (review.status === "due-today") {
            return "Due now";
        }

        if (this.isSameDay(review.dueAt)) {
            return `Today ${this.formatTime(review.dueAt)}`;
        }

        return review.reviewDate;
    }

    private getProblemStatusLabel(review: NonNullable<ReviewNode["review"]>): string {
        if (review.status === "overdue") {
            return `Overdue by ${review.overdueDays} day${review.overdueDays === 1 ? "" : "s"}`;
        }

        if (review.status === "due-today") {
            return "Due now";
        }

        if (this.isSameDay(review.dueAt)) {
            return `Due later today at ${this.formatTime(review.dueAt)}`;
        }

        return `Upcoming on ${review.reviewDate}`;
    }

    private formatRating(rating: NonNullable<ReviewNode["review"]>["lastRating"]): string {
        return rating ? rating.charAt(0).toUpperCase() + rating.slice(1) : "";
    }

    private isSameDay(value: string): boolean {
        const date = new Date(value);
        const now = new Date();
        return date.getFullYear() === now.getFullYear()
            && date.getMonth() === now.getMonth()
            && date.getDate() === now.getDate();
    }

    private formatTime(value: string): string {
        return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    private formatDueDate(value: string): string {
        const date = new Date(value);
        const dateLabel = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
        return `${dateLabel} ${this.formatTime(value)}`;
    }

    private getFilterSuffix(): string {
        const filters = reviewService.getActiveReviewFilters();
        return filters.length > 0 ? ` | ${filters.join(", ")}` : "";
    }

    private getFilterTooltip(): string {
        const filters = reviewService.getActiveReviewFilters();
        return filters.length > 0 ? `\nFiltered by: ${filters.join(", ")}` : "";
    }

    private formatInterval(days: number): string {
        if (days <= 0) {
            return "< 1 day";
        }

        return `${days} day${days === 1 ? "" : "s"}`;
    }
}

export const reviewTreeDataProvider: ReviewTreeDataProvider = new ReviewTreeDataProvider();
