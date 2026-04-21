import * as vscode from "vscode";
import { ReviewItem, ReviewSectionId } from "./types";

export type ReviewNodeKind = "setup" | "message" | "section" | "problem";

export class ReviewNode {
    constructor(
        public readonly id: string,
        public readonly label: string,
        public readonly kind: ReviewNodeKind,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly description?: string,
        public readonly tooltip?: string,
        public readonly review?: ReviewItem,
        public readonly sectionId?: ReviewSectionId,
        public readonly command?: vscode.Command,
    ) { }
}
