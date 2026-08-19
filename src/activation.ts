import { ActivationDisposalError } from "./activationErrors";

export { ActivationDisposalError } from "./activationErrors";

export interface DisposableLike {
    dispose(): void;
}

export interface NodeEventSource {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

export const CORE_RESOURCE_KEYS = [
    "statusBar", "channel", "previewProvider", "pastSubmissionsProvider", "submissionProvider",
    "submissionDetailProvider", "solutionProvider", "executor", "markdownEngine", "leetnotionEngine",
    "codeLensController", "tracking", "profileDashboardProvider", "leetcodeTreeProvider",
    "reviewTreeProvider", "studyTreeProvider", "explorerNodeManager", "recurringWork",
] as const;

export type CoreResourceKey = typeof CORE_RESOURCE_KEYS[number];
export type CoreActivationResources = Record<CoreResourceKey, DisposableLike>;

export const EXTENSION_COMMAND_IDS = [
    "leetnotion.deleteCache",
    "leetnotion.toggleLeetCodeCn",
    "leetnotion.signin",
    "leetnotion.signout",
    "leetnotion.refreshHome",
    "leetnotion.lookupProfile",
    "leetnotion.previewProblem",
    "leetnotion.previewReviewProblem",
    "leetnotion.openReviewProblem",
    "leetnotion.addToReview",
    "leetnotion.addToBacklog",
    "leetnotion.startReviewSession",
    "leetnotion.startStudySession",
    "leetnotion.setReviewFilters",
    "leetnotion.setStudyFilters",
    "leetnotion.setDailyNewProblemLimit",
    "leetnotion.markReviewReviewed",
    "leetnotion.snoozeReview",
    "leetnotion.refreshStudy",
    "leetnotion.previewStudyProblem",
    "leetnotion.openStudyProblem",
    "leetnotion.markStudyProblemDone",
    "leetnotion.removeFromBacklog",
    "leetnotion.showProblem",
    "leetnotion.pickOne",
    "leetnotion.searchProblem",
    "leetnotion.searchCompany",
    "leetnotion.searchTag",
    "leetnotion.searchSheets",
    "leetnotion.searchContests",
    "leetnotion.searchList",
    "leetnotion.showSolution",
    "leetnotion.showPastSubmissions",
    "leetnotion.showPastSubmissionsByQuestionNumber",
    "leetnotion.showSubmissionDetail",
    "leetnotion.refreshExplorer",
    "leetnotion.refreshReviews",
    "leetnotion.testSolution",
    "leetnotion.submitSolution",
    "leetnotion.switchDefaultLanguage",
    "leetnotion.addFavorite",
    "leetnotion.removeFavorite",
    "leetnotion.pinSheet",
    "leetnotion.unpinSheet",
    "leetnotion.problems.sort",
    "leetnotion.clearAllData",
    "leetnotion.updateTemplateInfo",
    "leetnotion.integrateNotion",
    "leetnotion.updateTemplate",
    "leetnotion.addSubmissions",
] as const;

export type ExtensionCommandId = typeof EXTENSION_COMMAND_IDS[number];
export const INTERNAL_COMMAND_IDS: readonly ExtensionCommandId[] = [
    "leetnotion.showPastSubmissionsByQuestionNumber",
    "leetnotion.showSubmissionDetail",
];
export type CommandHandler = (...args: any[]) => any;
export type ExtensionCommandHandlers = Record<ExtensionCommandId, CommandHandler>;

export interface ExtensionRegistrationDependencies {
    commandHandlers: ExtensionCommandHandlers;
    registerCommand(command: string, handler: CommandHandler): DisposableLike;
    registerStopSession(): DisposableLike;
    registerFileDecorationProvider(): DisposableLike;
    registerWebviewViewProvider(): DisposableLike;
    registerStatusListener(): DisposableLike;
    registerUriHandler(): DisposableLike;
}

export async function initializeDurableMapping(initialize: () => Promise<unknown>): Promise<void> {
    await initialize();
}

export async function runActivationGuard(
    resources: DisposableLike,
    initialize: () => Promise<void>,
    handleFailure: (error: unknown) => Promise<void> | void,
): Promise<boolean> {
    try {
        await initialize();
        return true;
    } catch (error) {
        try {
            await handleFailure(error);
        } finally {
            resources.dispose();
        }
        return false;
    }
}

export class ActivationResources implements DisposableLike {
    private readonly resources: DisposableLike[] = [];
    private disposed = false;

    public add(...resources: DisposableLike[]): DisposableLike[] {
        if (this.disposed) {
            this.disposeResources(resources);
            return resources;
        }
        this.resources.push(...resources);
        return resources;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.disposeResources(this.resources.splice(0).reverse());
    }

    private disposeResources(resources: DisposableLike[]): void {
        const errors: unknown[] = [];
        for (const resource of resources) {
            try {
                resource.dispose();
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length > 0) {
            throw new ActivationDisposalError(errors);
        }
    }
}

export function registerActivationResources(register: () => DisposableLike[]): ActivationResources {
    const resources = new ActivationResources();
    resources.add(...register());
    return resources;
}

export function registerCoreActivationResources(resources: CoreActivationResources): ActivationResources {
    return registerActivationResources(() => CORE_RESOURCE_KEYS.map((key) => resources[key]));
}

export function ownTreeViews(
    owner: ActivationResources,
    treeViews: readonly [DisposableLike, DisposableLike, DisposableLike],
): void {
    owner.add(...treeViews);
}

export function createOwnedResources<T extends readonly DisposableLike[]>(
    owner: ActivationResources,
    factories: { readonly [K in keyof T]: () => T[K] },
): T {
    const created: DisposableLike[] = [];
    for (const factory of factories as readonly (() => DisposableLike)[]) {
        const resource = factory();
        owner.add(resource);
        created.push(resource);
    }
    return created as unknown as T;
}

export function registerExtensionResources(dependencies: ExtensionRegistrationDependencies): ActivationResources {
    const resources = new ActivationResources();
    try {
        resources.add(dependencies.registerFileDecorationProvider());
        resources.add(dependencies.registerWebviewViewProvider());
        resources.add(dependencies.registerStatusListener());
        resources.add(dependencies.registerUriHandler());
        for (const command of EXTENSION_COMMAND_IDS) {
            resources.add(dependencies.registerCommand(command, dependencies.commandHandlers[command]));
        }
        resources.add(dependencies.registerStopSession());
        return resources;
    } catch (error) {
        resources.dispose();
        throw error;
    }
}

export function registerNodeEvent(
    source: NodeEventSource,
    event: string,
    listener: (...args: unknown[]) => void,
): DisposableLike {
    source.on(event, listener);
    let disposed = false;
    return {
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            source.removeListener(event, listener);
        },
    };
}
