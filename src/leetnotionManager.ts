import * as fse from 'fs-extra';
import { globalState } from "./globalState";
import { InputBoxOptions, OpenDialogOptions, ProgressLocation, Uri, window } from "vscode";
import { leetCodeChannel } from "./leetCodeChannel";
import { DialogType, getBelongingWorkspaceFolderUri, promptForOpenOutputChannel } from "./utils/uiUtils";
import { getWorkspaceConfiguration, hasNotionIntegrationEnabled } from "./utils/settingUtils";
import { leetnotionClient } from "./leetnotionClient";
import { leetcodeClient } from "./leetCodeClient";
import { leetCodeManager } from "./leetCodeManager";
import { UserStatus } from "./shared";
import { LeetcodeSubmission } from "./types";
import { PageObjectResponse } from '@leetnotion/notion-api';
import { templateUpdateSession } from './modules/leetnotion/session';
import {
    collectExistingSubmissionIds,
    formatBulkImportResult,
    parseSubmissionRows,
} from "./submissions/bulkImport";

class LeetnotionManager {
    public async enableNotionIntegration(): Promise<void> {
        const accessToken = await this.getAccessToken();
        try {
            if (!accessToken || accessToken === "") {
                promptForOpenOutputChannel("Notion integration disabled. To enable notion integration run 'Integrate notion' leetnotion command.", DialogType.info);
                this.disableNotionIntegration();
                return;
            }
            if (!(await leetnotionClient.isValidAccessToken(accessToken))) {
                promptForOpenOutputChannel("Invalid notion access token.", DialogType.error);
                leetCodeChannel.appendLine("Invalid notion access token. Ensure you have correct leetcode template and integrated the access token to your template.")
                this.disableNotionIntegration();
                return;
            }
            await globalState.setNotionAccessToken(accessToken);
            leetnotionClient.initialize();
            const previousQuestionsDatabaseId = globalState.getQuestionsDatabaseId();
            await leetnotionClient.setDatabaseIds();
            if (!previousQuestionsDatabaseId || previousQuestionsDatabaseId !== globalState.getQuestionsDatabaseId()) {
                await globalState.setNotionIntegrationStatus("pending");
                await this.updateNotionInfo();
            }
            await globalState.setNotionIntegrationStatus("done");
        } catch (error) {
            leetCodeChannel.appendLine(`Error enabling notion integration: ${error}`);
        }
    }

    private disableNotionIntegration(): void {
        getWorkspaceConfiguration().update("enableNotionIntegration", false);
    }

    private async getAccessToken(): Promise<string | undefined> {
        try {
            const accessToken = globalState.getNotionAccessToken();
            const inputOptions: InputBoxOptions = {
                placeHolder: "Eg: secret_123...",
                prompt: "Enter your notion access token",
                password: true,
                ignoreFocusOut: true,
                validateInput: (str: string): string | undefined => (str && str.trim() ? undefined : 'The input must not be empty')
            }
            if (!accessToken) {
                return await window.showInputBox(inputOptions);
            }
            const options = [
                'Use existing notion access token',
                'Use a new notion access token'
            ];
            const option = await window.showQuickPick(
                options,
                {
                    placeHolder: "There is already and existing notion access token"
                }
            )
            return option === options[0] ? accessToken : await window.showInputBox(inputOptions);
        } catch (error) {
            leetCodeChannel.appendLine(error);
            return undefined;
        }
    }

    public async updateNotionInfo(): Promise<void> {
        const totalNoOfPages = await leetcodeClient.getNoOfProblems();
        leetCodeChannel.appendLine("Started fetching template pages from notion.")
        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                cancellable: false,
                title: 'Loading questions from notion. Please wait...',
            },
            async progress => {
                progress.report({ increment: 0 })
                await leetnotionClient.updateTemplateInformation(() => {
                    progress.report({ increment: 10000 / totalNoOfPages });
                    leetCodeChannel.appendLine(`Collected 100 pages from notion`);
                });
            }
        )
    }

    public async uploadSubmissions() {
        try {
            if (!hasNotionIntegrationEnabled()) {
                leetCodeChannel.appendLine(`Notion integration not enabled. Enable notion integration and complete setup to upload submissions.`);
                promptForOpenOutputChannel(`Notion integration not enabled.`, DialogType.error);
                return;
            }
            await leetcodeClient.ensureTitleSlugQuestionNumberMapping();
            const source = await this.getLeetcodeSubmissions();
            const submissions = source.submissions;
            if (submissions.length === 0) {
                promptForOpenOutputChannel(
                    source.malformed > 0
                        ? `No valid submissions found. ${source.malformed} malformed rows were skipped.`
                        : `No submissions found to upload.`,
                    source.malformed > 0 ? DialogType.warning : DialogType.completed,
                );
                return;
            }
            let notionSubmissionPages: PageObjectResponse[] = [];
            let notionSubmissionsCount = 0;
            await window.withProgress(
                {
                    location: ProgressLocation.Notification,
                    cancellable: true,
                    title: 'Collecting existing submissions from notion',
                },
                async progress => {
                    notionSubmissionPages = await leetnotionClient.getSubmissionPages(response => {
                        notionSubmissionsCount += response.results.length;
                        progress.report({
                            message: `${notionSubmissionsCount} collected`,
                        });
                    });
                }
            );
            const existing = collectExistingSubmissionIds(notionSubmissionPages);
            const result = await window.withProgress(
                {
                    location: ProgressLocation.Notification,
                    cancellable: true,
                    title: 'Adding submissions to notion',
                },
                async (progress, cancellationToken) => {
                    return leetnotionClient.addSubmissions(submissions, existing.ids, source.malformed + existing.malformed, (counts) => {
                        progress.report({
                            message: `(${counts.added}/${submissions.length}) added`,
                            increment: (1 / submissions.length) * 100,
                        });
                    }, () => cancellationToken.isCancellationRequested);
                }
            );
            promptForOpenOutputChannel(
                formatBulkImportResult(result),
                result.cancelled || result.malformed > 0 || result.missingQuestion > 0 ? DialogType.warning : DialogType.completed,
            );
        } catch (error) {
            leetCodeChannel.appendLine(`Failed to upload submissions: ${error}`);
            promptForOpenOutputChannel(`Failed to upload submissions`, DialogType.error);
        }
    }

    public async getLeetcodeSubmissions() {
        if (leetCodeManager.getStatus() === UserStatus.SignedIn) {
            try {
                const rows = await window.withProgress(
                    {
                        location: ProgressLocation.Notification,
                        cancellable: false,
                        title: "Fetching submissions from LeetCode...",
                    },
                    async (progress) => {
                        return leetcodeClient.getAllSubmissions((submissionCount) => {
                            progress.report({
                                message: `${submissionCount} fetched`,
                            });
                        });
                    }
                );
                return parseSubmissionRows(rows);
            } catch (error) {
                leetCodeChannel.appendLine(`Failed to fetch submissions from LeetCode API, falling back to file import: ${error}`);
                window.showWarningMessage("Failed to fetch submissions from LeetCode. Falling back to submissions.json import.");
            }
        }

        return await this.getLeetcodeSubmissionsFromFile();
    }

    private async getLeetcodeSubmissionsFromFile() {
        const defaultUri: Uri | undefined = getBelongingWorkspaceFolderUri(undefined);
        const options: OpenDialogOptions = {
            defaultUri,
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Select',
            filters: {
                JSON: ['json'],
            },
            title: 'Select submissions.json where all your leetcode submissions contain.',
        };
        const submissionsFile: Uri[] | undefined = await window.showOpenDialog(options);
        if (submissionsFile && submissionsFile.length) {
            return parseSubmissionRows(fse.readJSONSync(submissionsFile[0].fsPath) as unknown);
        }
        throw new Error(`Error at getting submission from submissions.json`);
    }


    public async clearAllData(): Promise<void> {
        try {
            await leetCodeManager.signOut();
            await globalState.clearAllNotionDetails();
            await templateUpdateSession.close();
            leetnotionClient.signOut();
        } catch (error) {

        }
    }
}

export const leetnotionManager: LeetnotionManager = new LeetnotionManager();
