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
                item.iconPath = new vscode.ThemeIcon(element.sectionId === ReviewSectionId.Due ? "warning" : "calendar");
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
                    "Integrate Notion to see review reminders",
                    "setup",
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    "Configure your Leetnotion Notion workspace to load due reviews.",
                    undefined,
                    undefined,
                    {
                        title: "Integrate Notion",
                        command: "leetnotion.integrateNotion",
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
                    `${section.items.length}`,
                    `${section.items.length} review${section.items.length === 1 ? "" : "s"}`,
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
            review.pageId,
            `[${review.questionNumber}] ${review.name}`,
            "problem",
            vscode.TreeItemCollapsibleState.None,
            review.reviewDate,
            [`Difficulty: ${review.difficulty || "Unknown"}`, `Review Date: ${review.reviewDate}`].join("\n"),
            review,
            sectionGroup.id,
            {
                title: "Preview Problem",
                command: "leetnotion.previewReviewProblem",
                arguments: [review],
            },
        ));
    }
}

export const reviewTreeDataProvider: ReviewTreeDataProvider = new ReviewTreeDataProvider();
