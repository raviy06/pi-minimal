import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent"

export type PiMinimalConfig = {
	hideGauntletWidgets: boolean
}

const DEFAULTS: PiMinimalConfig = {
	hideGauntletWidgets: true,
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

	const record = parsed as Record<string, unknown>
	if (!Object.hasOwn(record, "hideGauntletWidgets")) {
		return
	}

	const value = record.hideGauntletWidgets
	if (typeof value !== "boolean") {
		console.error(`pi-minimal: hideGauntletWidgets must be a boolean in ${path}`)
		return
	}

	config.hideGauntletWidgets = value
}
