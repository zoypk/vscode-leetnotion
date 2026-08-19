import * as _ from "lodash";
import { Disposable, Event, EventEmitter } from "vscode";
import * as list from "../commands/list";
import { getSortingStrategy } from "../commands/plugin";
import { Category, CompanySortingStrategy, defaultProblem, ProblemRating, ProblemState, SortingStrategy, UserStatus } from "../shared";
import { getCompaniesSortingStrategy, shouldHideSolvedProblem } from "../utils/settingUtils";
import { LeetCodeNode } from "./LeetCodeNode";
import { globalState } from "../globalState";
import { getCompanyPopularity, getCompanyTags, getContests, getLists, getListsWithQuestions, getSheets, getTopicTags } from "../utils/dataUtils";
import { LeetnotionTree } from "../types";
import { leetcodeTreeView } from "../extension";
import { leetCodeChannel } from "../leetCodeChannel";
import { leetCodeManager } from "../leetCodeManager";
import { RefreshCoordinator } from "./refreshCoordinator";

interface ExplorerSnapshot {
    dataTree: LeetnotionTree;
    nodeMap: Map<string, LeetCodeNode>;
}

class ExplorerNodeManager implements Disposable {
    private explorerNodeMap: Map<string, LeetCodeNode> = new Map<string, LeetCodeNode>();
    private dataTree: LeetnotionTree = {};
    private onDidRefreshEvent: EventEmitter<void> = new EventEmitter<void>();
    private refreshCoordinator: RefreshCoordinator<ExplorerSnapshot> = new RefreshCoordinator<ExplorerSnapshot>({
        buildSnapshot: () => this.buildSnapshot(),
        installSnapshot: (snapshot) => this.installSnapshot(snapshot),
        reportError: (error) => this.reportRefreshError(error),
    });

    public readonly onDidRefresh: Event<void> = this.onDidRefreshEvent.event;

    public getSheetNodeId(sheetName: string): string {
        return `${this.hasPinnedSheet(sheetName) ? Category.PinnedSheets : Category.Sheets}#${sheetName}`;
    }

    public async refreshCache(): Promise<void> {
        await this.refreshCoordinator.requestRefresh();
    }

    private async buildSnapshot(): Promise<ExplorerSnapshot> {
        const shouldHideSolved: boolean = shouldHideSolvedProblem();
        const dailyProblem = globalState.getDailyProblem();
        const allSheets = getSheets();
        const pinnedSheets = this.getPinnedSheetsData(allSheets);
        const unpinnedSheets = this.getUnpinnedSheetsData(allSheets);
        const nodeMap: Map<string, LeetCodeNode> = new Map<string, LeetCodeNode>();

        let problems = await list.listProblems()
        if (leetCodeManager.getStatus() === UserStatus.SignedIn && problems.length === 0) {
            throw new Error("The LeetCode problem list was empty while signed in.");
        }
        problems = problems.filter(item => !shouldHideSolved || item.state !== ProblemState.AC)

        for (const problem of problems) {
            nodeMap.set(problem.id, new LeetCodeNode(problem));
        }
        const dataTree: LeetnotionTree = {
            [Category.All]: problems.map(problem => problem.id),
            [Category.Difficulty]: {
                Easy: problems.filter(({ difficulty }) => difficulty === "Easy").map(problem => problem.id),
                Medium: problems.filter(({ difficulty }) => difficulty === "Medium").map(problem => problem.id),
                Hard: problems.filter(({ difficulty }) => difficulty === "Hard").map(problem => problem.id),
            },
            [Category.Tag]: await getTopicTags(),
            [Category.Company]: getCompanyTags(),
            [Category.Contests]: await getContests(),
            [Category.Favorite]: problems.filter(({ isFavorite }) => isFavorite).map(problem => problem.id),
            [Category.Daily]: [dailyProblem],
            [Category.PinnedSheets]: pinnedSheets,
            [Category.Sheets]: unpinnedSheets,
            [Category.Lists]: await getListsWithQuestions(),
        }
        this.storeLeetCodeNodes(dataTree, nodeMap);
        return { dataTree, nodeMap };
    }

    private installSnapshot(snapshot: ExplorerSnapshot): void {
        this.explorerNodeMap = snapshot.nodeMap;
        this.dataTree = snapshot.dataTree;
        this.onDidRefreshEvent.fire();
    }

    private reportRefreshError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        leetCodeChannel.appendLine(`Failed to refresh the Explorer: ${message}`);
    }

    public getRootNodes(): LeetCodeNode[] {
        const nodes: LeetCodeNode[] = [];
        for (const category of Object.keys(this.dataTree)) {
            if (category === Category.PinnedSheets) {
                continue;
            }
            if(this.explorerNodeMap.has(category)) {
                const node = this.explorerNodeMap.get(category);
                nodes.push(node);
            }
        }

        const pinnedSheets = this.dataTree[Category.PinnedSheets];
        if (pinnedSheets && !Array.isArray(pinnedSheets)) {
            for (const sheetName of Object.keys(pinnedSheets)) {
                const node = this.explorerNodeMap.get(`${Category.PinnedSheets}#${sheetName}`);
                if (node) {
                    nodes.push(node);
                }
            }
        }
        return nodes;
    }

    public getNodeById(id: string): LeetCodeNode | undefined {
        return this.explorerNodeMap.get(id);
    }

    public getChildrenNodesById(id: string): LeetCodeNode[] {
        const data = this.getExplorerDataById(id);
        if (!data) {
            return []
        }
        if (Array.isArray(data)) {
            return this.applySortingStrategy(this.getProblemNodesByIds(data));
        } else {
            let res: LeetCodeNode[] = [];
            for (const key of Object.keys(data)) {
                if(this.explorerNodeMap.has(`${id}#${key}`)) {
                    const node = this.explorerNodeMap.get(`${id}#${key}`);
                    res.push(node);
                } else {
                    res.push(new LeetCodeNode(Object.assign({}, defaultProblem, {
                        id: `${id}#${key}`,
                        name: key,
                    }), false));
                }
            }
            res = this.applySortingStrategy(res, id);
            return res;
        }
    }

    public dispose(): void {
        this.explorerNodeMap.clear();
        this.dataTree = {};
        this.onDidRefreshEvent.dispose();
    }

    public getParentNode(childId: string): LeetCodeNode | undefined {
        if(!childId || childId === "") {
            return undefined;
        }
        const meta = childId.split("#");
        return this.explorerNodeMap.get(meta.slice(0, meta.length - 1).join("#"));
    }

    public getExplorerDataById(id: string) {
        let data = this.dataTree;
        if (!id || id === "") {
            return data;
        }
        const metaInfo: string[] = id.split("#");
        for (const key of metaInfo) {
            if (data[key] === undefined) {
                return null;
            }
            data = data[key];
        }
        return data;
    }

    public getProblemNodesByIds(ids: string[]): LeetCodeNode[] {
        const res: LeetCodeNode[] = [];
        for (const id of ids) {
            const node = this.explorerNodeMap.get(id);
            if (node) {
                res.push(node);
            }
        }
        return res;
    }

    public revealNode(id: string) {
        const node = this.explorerNodeMap.get(id);
        if (node && leetcodeTreeView) {
            leetcodeTreeView.reveal(node, { select: true, focus: true, expand: true });
        }
    }

    private applySortingStrategy(nodes: LeetCodeNode[], id?: string): LeetCodeNode[] {
        if (!id) {
            const strategy: SortingStrategy = getSortingStrategy();
            switch (strategy) {
                case SortingStrategy.AcceptanceRateAsc: return nodes.sort((x: LeetCodeNode, y: LeetCodeNode) => Number(x.acceptanceRate) - Number(y.acceptanceRate));
                case SortingStrategy.AcceptanceRateDesc: return nodes.sort((x: LeetCodeNode, y: LeetCodeNode) => Number(y.acceptanceRate) - Number(x.acceptanceRate));
                default: return nodes;
            }
        }
        if ([Category.PinnedSheets, Category.Sheets].some((category) => id.toLowerCase() === category.toLowerCase())) {
            const pinnedSheets = new Set(globalState.getPinnedSheets());
            const order = new Map<string, number>(nodes.map((node: LeetCodeNode, index: number) => [node.name, index] as [string, number]));
            return nodes.sort((a: LeetCodeNode, b: LeetCodeNode) => {
                const pinnedDiff = Number(pinnedSheets.has(b.name)) - Number(pinnedSheets.has(a.name));
                if (pinnedDiff !== 0) {
                    return pinnedDiff;
                }
                return (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0);
            });
        }
        if (id === Category.Company) {
            return this.applyCompanySortingStrategy(nodes);
        }
        if (id === Category.Tag || id === Category.Lists) {
            return nodes.sort((a: LeetCodeNode, b: LeetCodeNode) => a.name.localeCompare(b.name));
        }
        return nodes;
    }

    private applyCompanySortingStrategy(nodes: LeetCodeNode[]): LeetCodeNode[] {
        const strategy: CompanySortingStrategy = getCompaniesSortingStrategy();
        switch (strategy) {
            case CompanySortingStrategy.Alphabetical: {
                return nodes.sort((a: LeetCodeNode, b: LeetCodeNode): number => a.name.localeCompare(b.name));
            }
            case CompanySortingStrategy.Popularity: {
                const companyPopularityMapping = getCompanyPopularity();
                return nodes.sort((a: LeetCodeNode, b: LeetCodeNode): number => companyPopularityMapping[b.name] - companyPopularityMapping[a.name]);
            }
            default:
                return nodes;
        }
    }

    private hasPinnedSheet(sheetName: string): boolean {
        return globalState.isPinnedSheet(sheetName);
    }

    private getPinnedSheetsData(allSheets: Record<string, Record<string, string[]>>): Record<string, Record<string, string[]>> {
        const pinnedSheetNames = new Set(globalState.getPinnedSheets());
        return Object.entries(allSheets).reduce<Record<string, Record<string, string[]>>>((result, [sheetName, sheetData]) => {
            if (pinnedSheetNames.has(sheetName)) {
                result[sheetName] = sheetData;
            }

            return result;
        }, {});
    }

    private getUnpinnedSheetsData(allSheets: Record<string, Record<string, string[]>>): Record<string, Record<string, string[]>> {
        const pinnedSheetNames = new Set(globalState.getPinnedSheets());
        return Object.entries(allSheets).reduce<Record<string, Record<string, string[]>>>((result, [sheetName, sheetData]) => {
            if (!pinnedSheetNames.has(sheetName)) {
                result[sheetName] = sheetData;
            }

            return result;
        }, {});
    }

    private storeLeetCodeNodes(dataTree: LeetnotionTree, nodeMap: Map<string, LeetCodeNode>): void {
        function dfs(data, curr, map: Map<string, LeetCodeNode>) {
            if(!data || Array.isArray(data)) {
                return;
            }
            if (typeof data === "object") {
                for (const key of Object.keys(data)) {
                    let id = "";
                    if(curr === "") {
                        id = key;
                    } else {
                        id = curr + "#" + key;
                    }
                    map.set(id, new LeetCodeNode(Object.assign({}, defaultProblem, {
                        id,
                        name: key,
                    }), false));
                    dfs(data[key], id, map);
                }
            }
        }
        dfs(dataTree, "", nodeMap);
    }
}

export const explorerNodeManager: ExplorerNodeManager = new ExplorerNodeManager();
