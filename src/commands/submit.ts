// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import * as vscode from "vscode";
import { leetCodeChannel } from "../leetCodeChannel";
import { leetCodeTreeDataProvider } from "../explorer/LeetCodeTreeDataProvider";
import { leetCodeExecutor } from "../leetCodeExecutor";
import { leetCodeManager } from "../leetCodeManager";
import { DialogType, promptForOpenOutputChannel, promptForSignIn } from "../utils/uiUtils";
import { getActiveFilePath } from "../utils/workspaceUtils";
import { leetCodeSubmissionProvider } from "../webview/leetCodeSubmissionProvider";
import { hasNotionIntegrationEnabled } from "../utils/settingUtils";
import { leetnotionClient } from "../leetnotionClient";
import { leetcodeClient } from "../leetCodeClient";
import { createSubmissionSourceSnapshot } from "../submissions/sourceSnapshot";
import { runSubmitWorkflow } from "../submissions/submitWorkflow";
import { toWslPath, useWsl } from "../utils/wslUtils";

export async function submitSolution(uri?: vscode.Uri): Promise<void> {
    if (!leetCodeManager.getUser()) {
        promptForSignIn();
        return;
    }

    const filePath: string | undefined = await getActiveFilePath(uri);
    if (!filePath) {
        return;
    }
    const sourceText = vscode.window.activeTextEditor?.document.getText();

    try {
        await runSubmitWorkflow(filePath, {
            createSourceSnapshot: async (path) => {
                if (sourceText === undefined) {
                    throw new Error("submission-source-document-not-available");
                }
                const snapshot = await createSubmissionSourceSnapshot(path, sourceText);
                try {
                    return useWsl()
                        ? { ...snapshot, filePath: await toWslPath(snapshot.filePath) }
                        : snapshot;
                } catch (error) {
                    await snapshot.dispose();
                    throw error;
                }
            },
            captureBaseline: (questionNumber) => leetcodeClient.captureSubmissionBaseline(questionNumber),
            submit: (path) => leetCodeExecutor.submitSolution(path),
            correlate: (request) => leetcodeClient.waitForValidatedSubmission(request),
            showResult: (result, submission) => leetCodeSubmissionProvider.show(result, submission),
            shouldSyncToNotion: hasNotionIntegrationEnabled,
            syncToNotion: (submission) => leetnotionClient.submitSolution(submission),
            refreshExplorer: () => leetCodeTreeDataProvider.refresh(),
            reportCorrelationFailure: (error) => leetCodeChannel.appendLine(`Failed to correlate the submitted solution: ${error}`),
            showCorrelationWarning: () => {
                void vscode.window.showWarningMessage(
                    "The submission result could not be verified. Notion was not updated; see the Leetnotion output for details.",
                );
            },
        });
    } catch (error) {
        leetCodeChannel.appendLine(`Failed to submit the solution: ${error}`);
        await promptForOpenOutputChannel("Failed to submit the solution. Please open the output channel for details.", DialogType.error);
    }
}
