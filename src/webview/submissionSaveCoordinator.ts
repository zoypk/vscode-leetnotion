import type { AuthoritativeSubmissionState } from "../notion/submissionProperties";
import type { SelectTags, SubmissionResultContext } from "../types";
import type { ReviewEdit } from "./submissionMessages";

export interface SubmissionNotionContext {
    submissionId: number;
    questionNumber: string;
    questionPageId: string;
    submissionPageId: string;
    tags: SelectTags;
    reviewDate: string | null;
}

export interface SubmissionSaveSnapshot {
    generation: number;
    notionRevision: number;
    notionContext?: SubmissionNotionContext;
    savedState: AuthoritativeSubmissionState;
    submissionContext?: SubmissionResultContext;
}

interface CommittedReview {
    generation: number;
    key: string;
    reviewDate: string | null;
}

export class SubmissionSaveCoordinator {
    private generation = 0;
    private submissionContext?: SubmissionResultContext;
    private notionContext?: SubmissionNotionContext;
    private savedState: AuthoritativeSubmissionState = emptyState();
    private pending = false;
    private notionRevision = 0;
    private committedReview?: CommittedReview;

    public begin(
        submissionContext: SubmissionResultContext | undefined,
        savedState: AuthoritativeSubmissionState,
        notionPending: boolean,
    ): number {
        this.generation += 1;
        this.submissionContext = submissionContext ? { ...submissionContext } : undefined;
        this.notionContext = undefined;
        this.savedState = cloneState(savedState);
        this.pending = notionPending;
        this.notionRevision = 0;
        this.committedReview = undefined;
        return this.generation;
    }

    public get currentGeneration(): number {
        return this.generation;
    }

    public get currentState(): AuthoritativeSubmissionState {
        return cloneState(this.savedState);
    }

    public get notionPending(): boolean {
        return this.pending;
    }

    public isCurrent(generation: number): boolean {
        return generation === this.generation;
    }

    public snapshotForSave(edit: ReviewEdit, expectedGeneration: number = this.generation): SubmissionSaveSnapshot {
        if (!this.isCurrent(expectedGeneration)) {
            throw new Error("stale-submission-message");
        }
        if (this.pending && edit.kind !== "unchanged") {
            throw new Error("notion-context-pending");
        }
        return {
            generation: this.generation,
            notionRevision: this.notionRevision,
            notionContext: this.notionContext ? cloneNotionContext(this.notionContext) : undefined,
            savedState: cloneState(this.savedState),
            submissionContext: this.submissionContext ? { ...this.submissionContext } : undefined,
        };
    }

    public installNotionContext(
        context: SubmissionNotionContext,
        savedState: AuthoritativeSubmissionState = this.savedState,
    ): boolean {
        if (!matchesIdentity(this.submissionContext, context)) {
            return false;
        }
        this.notionContext = cloneNotionContext(context);
        this.savedState = cloneState(savedState);
        this.pending = false;
        this.notionRevision += 1;
        return true;
    }

    public markNotionUnavailable(identity: { submissionId: number; questionNumber: string }): boolean {
        if (!this.pending || !matchesIdentity(this.submissionContext, identity)) {
            return false;
        }
        this.pending = false;
        return true;
    }

    public installSaved(
        generation: number,
        savedState: AuthoritativeSubmissionState,
        expectedNotionRevision: number,
    ): AuthoritativeSubmissionState | undefined {
        if (!this.isCurrent(generation)) {
            return undefined;
        }
        const nextState = expectedNotionRevision === this.notionRevision
            ? cloneState(savedState)
            : {
                ...cloneState(savedState),
                isOptimal: this.savedState.isOptimal,
                tags: [...this.savedState.tags],
                reviewDate: this.savedState.reviewDate,
            };
        this.savedState = nextState;
        this.committedReview = undefined;
        return cloneState(nextState);
    }

    public recordCommittedReview(generation: number, key: string, reviewDate: string | null): void {
        if (this.isCurrent(generation)) {
            this.committedReview = { generation, key, reviewDate };
        }
    }

    public getCommittedReview(generation: number, key: string): string | null | undefined {
        const committed = this.committedReview;
        return committed && committed.generation === generation && committed.key === key
            ? committed.reviewDate
            : undefined;
    }

    public hasCommittedReview(generation: number, key: string): boolean {
        const committed = this.committedReview;
        return Boolean(committed && committed.generation === generation && committed.key === key);
    }
}

export function reviewEditKey(edit: ReviewEdit): string {
    return edit.kind === "date" || edit.kind === "rating"
        ? `${edit.kind}:${edit.value}`
        : edit.kind;
}

function matchesIdentity(
    active: { submissionId: number; questionNumber: string } | undefined,
    incoming: { submissionId: number; questionNumber: string },
): boolean {
    return Boolean(active
        && active.submissionId === incoming.submissionId
        && active.questionNumber === incoming.questionNumber);
}

function cloneNotionContext(context: SubmissionNotionContext): SubmissionNotionContext {
    return { ...context, tags: context.tags.map((tag) => ({ ...tag })) };
}

function cloneState(state: AuthoritativeSubmissionState): AuthoritativeSubmissionState {
    return { ...state, tags: [...state.tags] };
}

function emptyState(): AuthoritativeSubmissionState {
    return { notes: "", flagType: "WHITE", isOptimal: false, tags: [], reviewDate: null };
}
