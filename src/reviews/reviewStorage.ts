import * as fse from "fs-extra";
import * as path from "path";
import { getWorkspaceFolder } from "../utils/settingUtils";
import { ReviewStateFile } from "./types";

const REVIEW_STATE_VERSION = 1;
const REVIEW_STATE_DIRECTORY = ".leetnotion";
const REVIEW_STATE_FILE = "reviews.json";

function createEmptyState(): ReviewStateFile {
    return {
        version: REVIEW_STATE_VERSION,
        reviews: {},
    };
}

class ReviewStorage {
    public isConfigured(): boolean {
        return getWorkspaceFolder().trim() !== "";
    }

    public async load(): Promise<ReviewStateFile> {
        const filePath = this.getReviewFilePath();
        if (!await fse.pathExists(filePath)) {
            return createEmptyState();
        }

        try {
            const raw = await fse.readJson(filePath) as Partial<ReviewStateFile>;
            if (raw.version !== REVIEW_STATE_VERSION) {
                throw new Error(`Unsupported review state version: ${raw.version ?? "unknown"}.`);
            }

            if (!raw.reviews || typeof raw.reviews !== "object" || Array.isArray(raw.reviews)) {
                throw new Error("Review state must contain an object-shaped 'reviews' map.");
            }

            return {
                version: REVIEW_STATE_VERSION,
                reviews: raw.reviews,
            };
        } catch (error) {
            throw new Error(`Failed to load local reviews from ${filePath}: ${error instanceof Error ? error.message : error}`);
        }
    }

    public async save(state: ReviewStateFile): Promise<void> {
        const filePath = this.getReviewFilePath();
        const tempFilePath = `${filePath}.tmp`;

        await fse.ensureDir(path.dirname(filePath));

        try {
            await fse.writeJson(tempFilePath, {
                version: REVIEW_STATE_VERSION,
                reviews: state.reviews,
            }, { spaces: 2 });
            await fse.move(tempFilePath, filePath, { overwrite: true });
        } catch (error) {
            await fse.remove(tempFilePath).catch(() => undefined);
            throw new Error(`Failed to save local reviews to ${filePath}: ${error instanceof Error ? error.message : error}`);
        }
    }

    public getReviewFilePath(): string {
        const workspaceFolder = getWorkspaceFolder().trim();
        if (!workspaceFolder) {
            throw new Error("Set `leetnotion.workspaceFolder` to enable local reviews.");
        }

        return path.join(workspaceFolder, REVIEW_STATE_DIRECTORY, REVIEW_STATE_FILE);
    }
}

export const reviewStorage: ReviewStorage = new ReviewStorage();
