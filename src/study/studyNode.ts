import * as vscode from "vscode";
import { ReviewItem } from "../reviews/types";
import { StudyBacklogItem, StudySectionId } from "./types";

export type StudyNodeKind = "setup" | "message" | "section" | "review-problem" | "new-problem";

export class StudyNode {
    constructor(
        public readonly id: string,
        public readonly label: string,
        public readonly kind: StudyNodeKind,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly description?: string,
        public readonly tooltip?: string,
        public readonly sectionId?: StudySectionId,
        public readonly review?: ReviewItem,
        public readonly backlogItem?: StudyBacklogItem,
        public readonly command?: vscode.Command,
    ) { }
}
