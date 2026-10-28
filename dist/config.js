import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
export const EDIT_DIFF_MODES = ["always", "never", "expanded"];
const DEFAULTS = {
    // Hiding another extension's widgets is opt-in.
    hideGauntletWidgets: false,
    editDiff: "expanded",
    backgroundShortcut: "ctrl+b",
};
export function loadPiMinimalConfig(options) {
    const config = { ...DEFAULTS };
    applyLayer(config, join(options.agentDir, "pi-minimal.json"));
    if (options.projectTrusted) {
        applyLayer(config, join(options.cwd, CONFIG_DIR_NAME, "pi-minimal.json"));
    }
    return config;
}
function applyLayer(config, path) {
    let text;
    try {
        text = readFileSync(path, "utf8");
    }
    catch {
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        console.error(`pi-minimal: invalid JSON in ${path}`);
        return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.error(`pi-minimal: expected an object in ${path}`);
        return;
    }
    // Each key is validated on its own so one bad value does not discard the rest of the layer.
    const record = parsed;
    if (Object.hasOwn(record, "hideGauntletWidgets")) {
        const value = record.hideGauntletWidgets;
        if (typeof value === "boolean")
            config.hideGauntletWidgets = value;
        else
            console.error(`pi-minimal: hideGauntletWidgets must be a boolean in ${path}`);
    }
    if (Object.hasOwn(record, "backgroundShortcut")) {
        const value = record.backgroundShortcut;
        if (value === null || (typeof value === "string" && value.trim().length > 0))
            config.backgroundShortcut = value === null ? null : value.trim();
        else
            console.error(`pi-minimal: backgroundShortcut must be a key name such as "ctrl+b" or null in ${path}`);
    }
    if (Object.hasOwn(record, "editDiff")) {
        const value = record.editDiff;
        if (isEditDiffMode(value))
            config.editDiff = value;
        else
            console.error(`pi-minimal: editDiff must be one of ${EDIT_DIFF_MODES.map((mode) => `"${mode}"`).join(", ")} in ${path}`);
    }
}
function isEditDiffMode(value) {
    return typeof value === "string" && EDIT_DIFF_MODES.includes(value);
}
