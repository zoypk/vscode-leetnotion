// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import * as vscode from "vscode";
import {
    ActivationResources,
    ExtensionCommandHandlers,
    initializeDurableMapping,
    ownTreeViews,
    registerCoreActivationResources,
    registerExtensionResources,
    registerNodeEvent,
    runActivationGuard,
} from "./activation";
import { codeLensController } from "./codelens/CodeLensController";
import * as cache from "./commands/cache";
import { switchDefaultLanguage } from "./commands/language";
import * as plugin from "./commands/plugin";
import * as show from "./commands/show";
import * as sheet from "./commands/sheet";
import * as star from "./commands/star";
import * as submit from "./commands/submit";
import * as test from "./commands/test";
import { explorerNodeManager } from "./explorer/explorerNodeManager";
import { LeetCodeNode } from "./explorer/LeetCodeNode";
import { leetCodeTreeDataProvider } from "./explorer/LeetCodeTreeDataProvider";
import { leetCodeTreeItemDecorationProvider } from "./explorer/LeetCodeTreeItemDecorationProvider";
import { leetCodeChannel } from "./leetCodeChannel";
import { leetCodeExecutor } from "./leetCodeExecutor";
import { leetCodeManager } from "./leetCodeManager";
import * as reviewCommands from "./reviews/commands";
import { ReviewNode } from "./reviews/reviewNode";
import { reviewTreeDataProvider } from "./reviews/reviewTreeDataProvider";
import { registerStopSessionCommand, sessionState } from "./sessions/sessionState";
import * as studyCommands from "./study/commands";
import { StudyNode } from "./study/studyNode";
import { studyTreeDataProvider } from "./study/studyTreeDataProvider";
import { leetCodeStatusBarController } from "./statusbar/leetCodeStatusBarController";
import { DialogType, promptForOpenOutputChannel } from "./utils/uiUtils";
import { leetCodePreviewProvider } from "./webview/leetCodePreviewProvider";
import { leetCodePastSubmissionsProvider } from "./webview/leetCodePastSubmissionsProvider";
import { leetCodeSolutionProvider } from "./webview/leetCodeSolutionProvider";
import { leetCodeSubmissionDetailProvider } from "./webview/leetCodeSubmissionDetailProvider";
import { leetCodeSubmissionProvider } from "./webview/leetCodeSubmissionProvider";
import { markdownEngine } from "./webview/markdownEngine";
import { leetnotionEngine } from "./webview/leetnotionEngine";
import TrackData from "./utils/trackingUtils";
import { globalState } from "./globalState";
import { leetcodeClient } from "./leetCodeClient";
import { clearIntervals, repeatAction } from "./utils/toolUtils";
import { leetnotionManager } from "./leetnotionManager";
import { leetnotionClient } from "./leetnotionClient";
import { templateUpdater } from "./modules/leetnotion/template-updater";
import { setLists, setProblemRatingMap, setQuestionsOfAllLists } from "./utils/dataUtils";
import { UserStatus } from "./shared";
import { profileDashboardProvider } from "./home/profileDashboardProvider";

let intervals: NodeJS.Timeout[] = [];
export let leetcodeTreeView: vscode.TreeView<LeetCodeNode> | undefined;
let reviewTreeView: vscode.TreeView<ReviewNode> | undefined;
let studyTreeView: vscode.TreeView<StudyNode> | undefined;
let activeResources: ActivationResources | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    activeResources?.dispose();
    activeResources = new ActivationResources();
    context.subscriptions.push(activeResources);
    const recurringWork = {
        dispose: () => { intervals = clearIntervals(intervals); },
    };
    activeResources.add(registerCoreActivationResources({
        statusBar: leetCodeStatusBarController,
        channel: leetCodeChannel,
        previewProvider: leetCodePreviewProvider,
        pastSubmissionsProvider: leetCodePastSubmissionsProvider,
        submissionProvider: leetCodeSubmissionProvider,
        submissionDetailProvider: leetCodeSubmissionDetailProvider,
        solutionProvider: leetCodeSolutionProvider,
        executor: leetCodeExecutor,
        markdownEngine,
        leetnotionEngine,
        codeLensController,
        tracking: TrackData,
        profileDashboardProvider,
        leetcodeTreeProvider: leetCodeTreeDataProvider,
        reviewTreeProvider: reviewTreeDataProvider,
        studyTreeProvider: studyTreeDataProvider,
        explorerNodeManager,
        recurringWork,
    }));
    const activationSucceeded = await runActivationGuard(activeResources, async () => {
        if (!(await leetCodeExecutor.meetRequirements(context))) {
            throw new Error("The environment doesn't meet requirements.");
        }

        const handleStatusChanged = () => {
            leetCodeStatusBarController.updateStatusBar(leetCodeManager.getStatus(), leetCodeManager.getUser());
            leetCodeTreeDataProvider.refresh();
            leetcodeClient.initialize();
            void profileDashboardProvider.refresh();

            const nextStatus = leetCodeManager.getStatus();
            if (nextStatus === UserStatus.SignedIn && intervals.length === 0) {
                startRecurringTasks();
            } else if (nextStatus === UserStatus.SignedOut) {
                intervals = clearIntervals(intervals);
            }
        };

        leetCodeTreeDataProvider.initialize(context);
        await globalState.initialize(context);
        leetcodeClient.initialize();
        leetnotionClient.initialize();
        await sessionState.initialize((key, value) => vscode.commands.executeCommand("setContext", key, value));

        const status = leetCodeManager.getStatus();
        if (status === UserStatus.SignedIn) {
            startRecurringTasks();
        }

        await initializeDurableMapping(() => leetcodeClient.setTitleSlugQuestionNumberMapping());
        if (globalState.getNotionIntegrationStatus() === "pending") {
            leetnotionManager.updateNotionInfo().then(async () => {
                await globalState.setNotionIntegrationStatus("done");
                await reviewTreeDataProvider.refresh();
            });
        }

        leetcodeTreeView = vscode.window.createTreeView("leetnotionExplorer", { treeDataProvider: leetCodeTreeDataProvider, showCollapseAll: true });
        reviewTreeView = vscode.window.createTreeView("leetnotionReviews", { treeDataProvider: reviewTreeDataProvider, showCollapseAll: true });
        studyTreeView = vscode.window.createTreeView("leetnotionStudy", { treeDataProvider: studyTreeDataProvider, showCollapseAll: true });
        ownTreeViews(activeResources!, [leetcodeTreeView, reviewTreeView, studyTreeView]);

        const commandHandlers: ExtensionCommandHandlers = {
            "leetnotion.deleteCache": () => cache.deleteCache(),
            "leetnotion.toggleLeetCodeCn": () => plugin.switchEndpoint(),
            "leetnotion.signin": () => leetCodeManager.signIn(),
            "leetnotion.signout": () => leetCodeManager.signOut(),
            "leetnotion.refreshHome": () => profileDashboardProvider.refresh(),
            "leetnotion.lookupProfile": () => profileDashboardProvider.promptForUsername(),
            "leetnotion.previewProblem": (node: vscode.Uri) => show.previewProblem(node),
            "leetnotion.previewReviewProblem": (review) => reviewCommands.previewReviewProblem(review),
            "leetnotion.openReviewProblem": (review) => reviewCommands.openReviewProblem(review),
            "leetnotion.addToReview": (input?: LeetCodeNode | vscode.Uri) => reviewCommands.addProblemToReview(input),
            "leetnotion.addToBacklog": (input?: LeetCodeNode | vscode.Uri) => studyCommands.addProblemToBacklog(input),
            "leetnotion.startReviewSession": () => reviewCommands.startReviewSession(),
            "leetnotion.startStudySession": () => studyCommands.startStudySession(),
            "leetnotion.setReviewFilters": () => reviewCommands.setReviewFilters(),
            "leetnotion.setStudyFilters": () => studyCommands.setStudyFilters(),
            "leetnotion.setDailyNewProblemLimit": () => studyCommands.setDailyNewProblemLimit(),
            "leetnotion.markReviewReviewed": (review) => reviewCommands.markReviewReviewed(review),
            "leetnotion.snoozeReview": (review) => reviewCommands.snoozeReview(review),
            "leetnotion.refreshStudy": () => studyTreeDataProvider.refresh(),
            "leetnotion.previewStudyProblem": (target) => studyCommands.previewStudyProblem(target),
            "leetnotion.openStudyProblem": (target) => studyCommands.openStudyProblem(target),
            "leetnotion.markStudyProblemDone": (target) => studyCommands.markStudyProblemDone(target),
            "leetnotion.removeFromBacklog": (target) => studyCommands.removeProblemFromBacklog(target),
            "leetnotion.showProblem": (node: LeetCodeNode) => show.showProblem(node),
            "leetnotion.pickOne": () => show.pickOne(),
            "leetnotion.searchProblem": () => show.searchProblem(),
            "leetnotion.searchCompany": () => show.searchCompany(),
            "leetnotion.searchTag": () => show.searchTag(),
            "leetnotion.searchSheets": () => show.searchSheets(),
            "leetnotion.searchContests": () => show.searchContests(),
            "leetnotion.searchList": () => show.searchLists(),
            "leetnotion.showSolution": (input: LeetCodeNode | vscode.Uri) => show.showSolution(input),
            "leetnotion.showPastSubmissions": (input?: LeetCodeNode | vscode.Uri) => show.showPastSubmissions(input),
            "leetnotion.showPastSubmissionsByQuestionNumber": (questionNumber: string, title?: string) => show.showPastSubmissionsByQuestionNumber(questionNumber, title),
            "leetnotion.showSubmissionDetail": (submissionId: number) => show.showSubmissionDetail(submissionId),
            "leetnotion.refreshExplorer": () => leetCodeTreeDataProvider.refresh(),
            "leetnotion.refreshReviews": () => reviewTreeDataProvider.refresh(),
            "leetnotion.testSolution": (uri?: vscode.Uri) => {
                TrackData.report({
                    event_key: `vscode_runCode`,
                    type: "click",
                    extra: JSON.stringify({
                        path: uri?.path,
                    }),
                });
                return test.testSolution(uri);
            },
            "leetnotion.submitSolution": (uri?: vscode.Uri) => {
                TrackData.report({
                    event_key: `vscode_submit`,
                    type: "click",
                    extra: JSON.stringify({
                        path: uri?.path,
                    }),
                });
                return submit.submitSolution(uri);
            },
            "leetnotion.switchDefaultLanguage": () => switchDefaultLanguage(),
            "leetnotion.addFavorite": (node: LeetCodeNode) => star.addFavorite(node),
            "leetnotion.removeFavorite": (node: LeetCodeNode) => star.removeFavorite(node),
            "leetnotion.pinSheet": (node: LeetCodeNode) => sheet.pinSheet(node),
            "leetnotion.unpinSheet": (node: LeetCodeNode) => sheet.unpinSheet(node),
            "leetnotion.problems.sort": () => plugin.switchSortingStrategy(),
            "leetnotion.clearAllData": async () => {
                await leetnotionManager.clearAllData();
                await reviewTreeDataProvider.refresh();
                await studyTreeDataProvider.refresh();
            },
            "leetnotion.updateTemplateInfo": async () => {
                await leetnotionManager.updateNotionInfo();
                await reviewTreeDataProvider.refresh();
                await studyTreeDataProvider.refresh();
            },
            "leetnotion.integrateNotion": async () => {
                await leetnotionManager.enableNotionIntegration();
                await reviewTreeDataProvider.refresh();
                await studyTreeDataProvider.refresh();
            },
            "leetnotion.updateTemplate": () => templateUpdater.updateTemplate(),
            "leetnotion.addSubmissions": () => leetnotionManager.uploadSubmissions(),
        };
        activeResources.add(registerExtensionResources({
            commandHandlers,
            registerCommand: (command, handler) => vscode.commands.registerCommand(command, handler),
            registerStopSession: () => registerStopSessionCommand(
                (command, handler) => vscode.commands.registerCommand(command, handler),
                sessionState,
                () => { void vscode.window.showInformationMessage("Leetnotion session stopped."); },
            ),
            registerFileDecorationProvider: () => vscode.window.registerFileDecorationProvider(leetCodeTreeItemDecorationProvider),
            registerWebviewViewProvider: () => vscode.window.registerWebviewViewProvider(
                "leetnotionHome",
                profileDashboardProvider,
                { webviewOptions: { retainContextWhenHidden: true } },
            ),
            registerStatusListener: () => registerNodeEvent(leetCodeManager, "statusChanged", handleStatusChanged),
            registerUriHandler: () => vscode.window.registerUriHandler({ handleUri: leetCodeManager.handleUriSignIn }),
        }));

        await leetCodeExecutor.switchEndpoint(plugin.getLeetCodeEndpoint());
        await leetCodeManager.getLoginStatus();
    }, async (error) => {
        await sessionState.dispose();
        leetCodeChannel.appendLine(String(error));
        promptForOpenOutputChannel("Extension initialization failed. Please open output channel for details.", DialogType.error);
    });
    if (!activationSucceeded) {
        activeResources = undefined;
    }
}

export async function deactivate(): Promise<void> {
    activeResources?.dispose();
    activeResources = undefined;
    intervals = clearIntervals(intervals);
    await sessionState.dispose();
}

function startRecurringTasks() {
    intervals.push(
        repeatAction(async () => {
            try {
                await Promise.all([
                    leetcodeClient.checkIn(),
                    leetcodeClient.collectEasterEgg(),
                    leetcodeClient.setDailyProblem(),
                    leetnotionClient.setUserQuestionTags(),
                ]);
                leetCodeTreeDataProvider.refresh();
            } catch (error) {
                leetCodeChannel.appendLine(`Failed to perform 30-min interval tasks: ${error}`);
            }
        }, 1000 * 60 * 30)
    );

    intervals.push(
        repeatAction(async () => {
            try {
                await Promise.all([
                    setLists(),
                    setQuestionsOfAllLists(),
                    setProblemRatingMap(),
                ]);
            } catch (error) {
                leetCodeChannel.appendLine(`Failed to perform 2-hour interval tasks: ${error}`);
            }
        }, 1000 * 60 * 60 * 2)
    );
}

