type PersistedDashboardState = {
    scrollY: number;
    openDisclosures: string[];
};

type VsCodeApi = {
    getState(): PersistedDashboardState | undefined;
    postMessage(message: { action: string }): void;
    setState(state: PersistedDashboardState): void;
};

declare function acquireVsCodeApi(): VsCodeApi;

const allowedActions = new Set(["lookup", "refresh", "signin", "useSignedInProfile"]);
const vscode = acquireVsCodeApi();
const restored = normalizeState(vscode.getState());

for (const disclosure of document.querySelectorAll<HTMLDetailsElement>("details[data-state-id]")) {
    const stateId = disclosure.dataset.stateId;
    disclosure.open = Boolean(stateId && restored.openDisclosures.includes(stateId));
    disclosure.addEventListener("toggle", persistState);
}

document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]") : null;
    const action = target?.dataset.action;
    if (!action || !allowedActions.has(action)) {
        return;
    }
    if (action === "refresh") {
        const status = document.getElementById("refresh-status");
        if (status) {
            status.textContent = "Refreshing profile.";
        }
    }
    persistState();
    vscode.postMessage({ action });
});

let scrollFrame = 0;
window.addEventListener("scroll", () => {
    if (scrollFrame) {
        return;
    }
    scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        persistState();
    });
}, { passive: true });

window.requestAnimationFrame(() => window.scrollTo(0, restored.scrollY));

function persistState(): void {
    const openDisclosures = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-state-id][open]"))
        .map((details) => details.dataset.stateId)
        .filter((stateId): stateId is string => Boolean(stateId));
    vscode.setState({ scrollY: Math.max(0, window.scrollY), openDisclosures });
}

function normalizeState(value: PersistedDashboardState | undefined): PersistedDashboardState {
    if (!value || !Number.isFinite(value.scrollY) || !Array.isArray(value.openDisclosures)) {
        return { scrollY: 0, openDisclosures: [] };
    }
    return {
        scrollY: Math.max(0, value.scrollY),
        openDisclosures: value.openDisclosures.filter((item): item is string => typeof item === "string"),
    };
}
