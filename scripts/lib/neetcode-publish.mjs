import fs from "node:fs";
import path from "node:path";
import { atomicPublishEntries } from "./sync-utils.mjs";

function toContentPathMap(contents) {
    const contentByPath = new Map();
    for (const [questionId, content] of contents) {
        contentByPath.set(`neetcode-content/${questionId}.json`, content);
    }
    return contentByPath;
}

export function publishNeetCodeDataset(options) {
    const {
        contentDirectory,
        contents,
        dataset,
        fsOperations,
        indexPath,
        validateDataset,
    } = options;
    if (typeof validateDataset !== "function") {
        throw new Error("publishNeetCodeDataset requires a validator");
    }
    validateDataset(dataset, toContentPathMap(contents));

    atomicPublishEntries([
        {
            path: contentDirectory,
            populate: (stagedDirectory, operations) => {
                operations.mkdirSync(stagedDirectory, { recursive: true });
                for (const [questionId, content] of contents) {
                    operations.writeFileSync(
                        path.join(stagedDirectory, `${questionId}.json`),
                        `${JSON.stringify(content, null, 2)}\n`,
                        "utf8",
                    );
                }
            },
        },
        // The index is the generation commit point, so publish it only after every content file is in place.
        { path: indexPath, content: `${JSON.stringify(dataset, null, 2)}\n` },
    ], {
        fsOperations,
        validate: (stagedPaths) => {
            const stagedIndex = JSON.parse(fs.readFileSync(stagedPaths.get(indexPath), "utf8"));
            const stagedContentDirectory = stagedPaths.get(contentDirectory);
            const stagedContents = new Map();
            for (const fileName of fs.readdirSync(stagedContentDirectory)) {
                const relativePath = `neetcode-content/${fileName}`;
                stagedContents.set(
                    relativePath,
                    JSON.parse(fs.readFileSync(path.join(stagedContentDirectory, fileName), "utf8")),
                );
            }
            validateDataset(stagedIndex, stagedContents);
        },
    });
}
