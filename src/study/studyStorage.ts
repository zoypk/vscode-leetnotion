import * as path from "path";
import { VersionedJsonStore } from "../state/versionedJsonStore";
import { getWorkspaceFolder } from "../utils/settingUtils";
import { parseStudyStateFile, StudyStateFile } from "./types";

const STUDY_STATE_DIRECTORY = ".leetnotion";
const STUDY_STATE_FILE = "study.json";

export interface StudyStateStorage {
    isConfigured(): boolean;
    read(): Promise<StudyStateFile>;
    transaction<R>(mutator: (state: StudyStateFile) => R extends PromiseLike<unknown> ? never : R): Promise<R>;
}

export class StudyStorage implements StudyStateStorage {
    private readonly store: VersionedJsonStore<StudyStateFile>;

    constructor(private readonly workspaceFolder: () => string = getWorkspaceFolder) {
        this.store = new VersionedJsonStore({
            filePath: () => this.getStudyFilePath(),
            createEmpty: () => ({ version: 1, backlog: {}, dailyPlans: {} }),
            parse: parseStudyStateFile,
        });
    }

    public isConfigured(): boolean {
        return this.workspaceFolder().trim() !== "";
    }

    public read(): Promise<StudyStateFile> {
        return this.store.read();
    }

    public transaction<R>(mutator: (state: StudyStateFile) => R extends PromiseLike<unknown> ? never : R): Promise<R> {
        return this.store.transaction(mutator);
    }

    public getStudyFilePath(): string {
        const workspaceFolder = this.workspaceFolder().trim();
        if (!workspaceFolder) {
            throw new Error("Set `leetnotion.workspaceFolder` to enable local study planning.");
        }
        return path.join(workspaceFolder, STUDY_STATE_DIRECTORY, STUDY_STATE_FILE);
    }
}

export const studyStorage: StudyStateStorage = new StudyStorage();
