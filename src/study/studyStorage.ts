import * as fse from "fs-extra";
import * as path from "path";
import { getWorkspaceFolder } from "../utils/settingUtils";
import { StudyStateFile } from "./types";

const STUDY_STATE_VERSION = 1;
const STUDY_STATE_DIRECTORY = ".leetnotion";
const STUDY_STATE_FILE = "study.json";

function createEmptyState(): StudyStateFile {
    return {
        version: STUDY_STATE_VERSION,
        backlog: {},
        dailyPlans: {},
    };
}

class StudyStorage {
    public isConfigured(): boolean {
        return getWorkspaceFolder().trim() !== "";
    }

    public async load(): Promise<StudyStateFile> {
        const filePath = this.getStudyFilePath();
        if (!await fse.pathExists(filePath)) {
            return createEmptyState();
        }

        try {
            const raw = await fse.readJson(filePath) as Partial<StudyStateFile>;
            if (raw.version !== STUDY_STATE_VERSION) {
                throw new Error(`Unsupported study state version: ${raw.version ?? "unknown"}.`);
            }

            if (!raw.backlog || typeof raw.backlog !== "object" || Array.isArray(raw.backlog)) {
                throw new Error("Study state must contain an object-shaped 'backlog' map.");
            }

            if (!raw.dailyPlans || typeof raw.dailyPlans !== "object" || Array.isArray(raw.dailyPlans)) {
                throw new Error("Study state must contain an object-shaped 'dailyPlans' map.");
            }

            return {
                version: STUDY_STATE_VERSION,
                backlog: raw.backlog,
                dailyPlans: raw.dailyPlans,
            };
        } catch (error) {
            throw new Error(`Failed to load local study state from ${filePath}: ${error instanceof Error ? error.message : error}`);
        }
    }

    public async save(state: StudyStateFile): Promise<void> {
        const filePath = this.getStudyFilePath();
        const tempFilePath = `${filePath}.tmp`;

        await fse.ensureDir(path.dirname(filePath));

        try {
            await fse.writeJson(tempFilePath, {
                version: STUDY_STATE_VERSION,
                backlog: state.backlog,
                dailyPlans: state.dailyPlans,
            }, { spaces: 2 });
            await fse.move(tempFilePath, filePath, { overwrite: true });
        } catch (error) {
            await fse.remove(tempFilePath).catch(() => undefined);
            throw new Error(`Failed to save local study state to ${filePath}: ${error instanceof Error ? error.message : error}`);
        }
    }

    public getStudyFilePath(): string {
        const workspaceFolder = getWorkspaceFolder().trim();
        if (!workspaceFolder) {
            throw new Error("Set `leetnotion.workspaceFolder` to enable local study planning.");
        }

        return path.join(workspaceFolder, STUDY_STATE_DIRECTORY, STUDY_STATE_FILE);
    }
}

export const studyStorage: StudyStorage = new StudyStorage();
