import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { extractSubmissionSource } from "./submissionCorrelation";
import type { SubmissionSourceSnapshot } from "./types";

export async function createSubmissionSourceSnapshot(
    originalFilePath: string,
    fileContent: string,
): Promise<SubmissionSourceSnapshot> {
    const source = extractSubmissionSource(originalFilePath, fileContent);
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "leetnotion-submit-"));
    const snapshotFilePath = path.join(temporaryDirectory, `solution${path.extname(originalFilePath)}`);

    try {
        await fs.writeFile(snapshotFilePath, fileContent, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
        });
    } catch (error) {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
        throw error;
    }

    return {
        ...source,
        filePath: snapshotFilePath,
        dispose: async () => fs.rm(temporaryDirectory, { recursive: true, force: true }),
    };
}
