declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();

document.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }
    const actionElement = target.closest<HTMLElement>("[data-action-id]");
    const actionId = actionElement?.dataset.actionId;
    if (!actionId) {
        return;
    }
    event.preventDefault();
    vscode.postMessage({ action: "invoke", id: actionId });
});
