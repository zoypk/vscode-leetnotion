// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import { LeetCodeNode } from "../explorer/LeetCodeNode";
import { leetCodeTreeDataProvider } from "../explorer/LeetCodeTreeDataProvider";
import { globalState } from "../globalState";
import { Category } from "../shared";
import { DialogType, promptForOpenOutputChannel } from "../utils/uiUtils";

function getSheetName(node: LeetCodeNode): string | undefined {
    const lowerCaseId = node.id.toLowerCase();
    const sheetPrefixes = [Category.Sheets, Category.PinnedSheets].map((category) => `${category.toLowerCase()}#`);
    if (!sheetPrefixes.some((prefix) => lowerCaseId.startsWith(prefix))) {
        return undefined;
    }
    return node.name;
}

async function updatePinnedSheets(sheet: string, pin: boolean): Promise<void> {
    const pinnedSheets = new Set(globalState.getPinnedSheets());
    if (pin) {
        pinnedSheets.add(sheet);
    } else {
        pinnedSheets.delete(sheet);
    }
    await globalState.setPinnedSheets(Array.from(pinnedSheets));
    await leetCodeTreeDataProvider.refresh();
}

export async function pinSheet(node: LeetCodeNode): Promise<void> {
    try {
        const sheet = getSheetName(node);
        if (!sheet) {
            return;
        }
        await updatePinnedSheets(sheet, true);
    } catch (error) {
        await promptForOpenOutputChannel("Failed to pin the sheet. Please open the output channel for details.", DialogType.error);
    }
}

export async function unpinSheet(node: LeetCodeNode): Promise<void> {
    try {
        const sheet = getSheetName(node);
        if (!sheet) {
            return;
        }
        await updatePinnedSheets(sheet, false);
    } catch (error) {
        await promptForOpenOutputChannel("Failed to unpin the sheet. Please open the output channel for details.", DialogType.error);
    }
}
