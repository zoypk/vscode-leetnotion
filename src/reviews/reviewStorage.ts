import * as path from "path";
import { VersionedJsonStore } from "../state/versionedJsonStore";
import { getWorkspaceFolder } from "../utils/settingUtils";
import { parseReviewStateFile, ReviewStateFile } from "./types";

const REVIEW_STATE_DIRECTORY = ".leetnotion";
const REVIEW_STATE_FILE = "reviews.json";

export interface ReviewStateStorage {
    isConfigured(): boolean;
    read(): Promise<ReviewStateFile>;
    transaction<R>(mutator: (state: ReviewStateFile) => R extends PromiseLike<unknown> ? never : R): Promise<R>;
}

export class ReviewStorage implements ReviewStateStorage {
    private readonly store: VersionedJsonStore<ReviewStateFile>;

    constructor(private readonly workspaceFolder: () => string = getWorkspaceFolder) {
        this.store = new VersionedJsonStore({
            filePath: () => this.getReviewFilePath(),
            createEmpty: () => ({ version: 1, reviews: {} }),
            parse: parseReviewStateFile,
        });
    }

    public isConfigured(): boolean {
        return this.workspaceFolder().trim() !== "";
    }

    public read(): Promise<ReviewStateFile> {
        return this.store.read();
    }

    public transaction<R>(mutator: (state: ReviewStateFile) => R extends PromiseLike<unknown> ? never : R): Promise<R> {
        return this.store.transaction(mutator);
    }

    public getReviewFilePath(): string {
        const workspaceFolder = this.workspaceFolder().trim();
        if (!workspaceFolder) {
            throw new Error("Set `leetnotion.workspaceFolder` to enable local reviews.");
        }
        return path.join(workspaceFolder, REVIEW_STATE_DIRECTORY, REVIEW_STATE_FILE);
    }
}

export const reviewStorage: ReviewStateStorage = new ReviewStorage();
