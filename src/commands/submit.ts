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
import { extractSubmissionSource, readSubmissionSource } from "../submissions/submissionCorrelation";
import { runSubmitWorkflow } from "../submissions/submitWorkflow";

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
            readSource: sourceText
                ? async (path) => extractSubmissionSource(path, sourceText)
                : readSubmissionSource,
            captureBaseline: (questionNumber) => leetcodeClient.captureSubmissionBaseline(questionNumber),
            submit: (path) => leetCodeExecutor.submitSolution(path),
            correlate: (request) => leetcodeClient.waitForValidatedSubmission(request),
            showResult: (result, submission) => leetCodeSubmissionProvider.show(result, submission),
            shouldSyncToNotion: hasNotionIntegrationEnabled,
            syncToNotion: (submission) => leetnotionClient.submitSolution(submission),
            refreshExplorer: () => leetCodeTreeDataProvider.refresh(),
            reportCorrelationFailure: (error) => leetCodeChannel.appendLine(`Failed to correlate the submitted solution: ${error}`),
        });
    } catch (error) {
        leetCodeChannel.appendLine(`Failed to submit the solution: ${error}`);
        await promptForOpenOutputChannel("Failed to submit the solution. Please open the output channel for details.", DialogType.error);
    }
}
