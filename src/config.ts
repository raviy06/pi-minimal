import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent"

/** When an `edit` row shows its diff: inline as soon as the edit lands, never, or only while expanded with ctrl+o. */
export type EditDiffMode = "always" | "never" | "expanded"
export const EDIT_DIFF_MODES: readonly EditDiffMode[] = ["always", "never", "expanded"]

export type PiMinimalConfig = {
	hideGauntletWidgets: boolean
	editDiff: EditDiffMode
	/** Key that opens the background-process overlay; `null` disables the shortcut (`/bg` still works). */
	backgroundShortcut: string | null
}

const DEFAULTS: PiMinimalConfig = {
	// Hiding another extension's widgets is opt-in.
	hideGauntletWidgets: false,
	editDiff: "expanded",
	backgroundShortcut: "ctrl+b",
}

export function loadPiMinimalConfig(options: {
	agentDir: string
	cwd: string
	projectTrusted: boolean
}): PiMinimalConfig {
	const config: PiMinimalConfig = { ...DEFAULTS }
	applyLayer(config, join(options.agentDir, "pi-minimal.json"))
	if (options.projectTrusted) {
		applyLayer(config, join(options.cwd, CONFIG_DIR_NAME, "pi-minimal.json"))
	}
	return config
}

function applyLayer(config: PiMinimalConfig, path: string): void {
	let text: string
	try {
		text = readFileSync(path, "utf8")
	} catch {
		return
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		console.error(`pi-minimal: invalid JSON in ${path}`)
		return
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		console.error(`pi-minimal: expected an object in ${path}`)
		return
	}

	// Each key is validated on its own so one bad value does not discard the rest of the layer.
	const record = parsed as Record<string, unknown>
	if (Object.hasOwn(record, "hideGauntletWidgets")) {
		const value = record.hideGauntletWidgets
		if (typeof value === "boolean") config.hideGauntletWidgets = value
		else console.error(`pi-minimal: hideGauntletWidgets must be a boolean in ${path}`)
	}
	if (Object.hasOwn(record, "backgroundShortcut")) {
		const value = record.backgroundShortcut
		if (value === null || (typeof value === "string" && value.trim().length > 0)) config.backgroundShortcut = value === null ? null : value.trim()
		else console.error(`pi-minimal: backgroundShortcut must be a key name such as "ctrl+b" or null in ${path}`)
	}
	if (Object.hasOwn(record, "editDiff")) {
		const value = record.editDiff
		if (isEditDiffMode(value)) config.editDiff = value
		else console.error(`pi-minimal: editDiff must be one of ${EDIT_DIFF_MODES.map((mode) => `"${mode}"`).join(", ")} in ${path}`)
	}
}

function isEditDiffMode(value: unknown): value is EditDiffMode {
	return typeof value === "string" && (EDIT_DIFF_MODES as readonly string[]).includes(value)
}
