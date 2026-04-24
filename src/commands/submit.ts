// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import * as vscode from "vscode";
import { leetCodeChannel } from "../leetCodeChannel";
import { leetcodeClient } from "../leetCodeClient";
import { leetCodeTreeDataProvider } from "../explorer/LeetCodeTreeDataProvider";
import { leetCodeExecutor } from "../leetCodeExecutor";
import { leetCodeManager } from "../leetCodeManager";
import { SubmissionDetailView, SubmissionResultContext } from "../types";
import { DialogType, promptForOpenOutputChannel, promptForSignIn } from "../utils/uiUtils";
import { getActiveFilePath } from "../utils/workspaceUtils";
import { leetCodeSubmissionProvider } from "../webview/leetCodeSubmissionProvider";
import { hasNotionIntegrationEnabled } from "../utils/settingUtils";
import { leetnotionClient } from "../leetnotionClient";
import { getQuestionNumber } from "../utils/toolUtils";

export async function submitSolution(uri?: vscode.Uri): Promise<void> {
    if (!leetCodeManager.getUser()) {
        promptForSignIn();
        return;
    }

    const filePath: string | undefined = await getActiveFilePath(uri);
    if (!filePath) {
        return;
    }

    try {
        const result: string = await leetCodeExecutor.submitSolution(filePath);
        const questionNumber = getQuestionNumber(filePath);
        const submissionData = questionNumber ? await resolveSubmissionResultContext(questionNumber) : undefined;

        leetCodeSubmissionProvider.show(result, submissionData?.context, submissionData?.detail);
        if(hasNotionIntegrationEnabled() && result.indexOf('Accepted') >= 0) {
            if(!questionNumber) return;
            await leetnotionClient.submitSolution(questionNumber);
        }
    } catch (error) {
        await promptForOpenOutputChannel("Failed to submit the solution. Please open the output channel for details.", DialogType.error);
        return;
    }

    leetCodeTreeDataProvider.refresh();
}

async function resolveSubmissionResultContext(questionNumber: string): Promise<{ context: SubmissionResultContext; detail: SubmissionDetailView } | undefined> {
    try {
        const submission = await leetcodeClient.getRecentSubmission();
        if (!submission) {
            return undefined;
        }

        const detail = await leetcodeClient.getSubmissionDetail(submission.id);
        return {
            context: {
                questionNumber,
                submissionId: submission.id,
                title: submission.title,
                notes: detail.notes,
                flagType: detail.flag_type,
            },
            detail,
        };
    } catch (error) {
        leetCodeChannel.appendLine(`Failed to load submission note context: ${error}`);
        return undefined;
    }
}
