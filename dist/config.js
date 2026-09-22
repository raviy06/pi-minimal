import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
const DEFAULTS = {
    hideGauntletWidgets: true,
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
    const record = parsed;
    if (!Object.hasOwn(record, "hideGauntletWidgets")) {
        return;
    }
    const value = record.hideGauntletWidgets;
    if (typeof value !== "boolean") {
        console.error(`pi-minimal: hideGauntletWidgets must be a boolean in ${path}`);
        return;
    }
    config.hideGauntletWidgets = value;
}
