import { firstLine, formatDuration, resultText, toolItem, type ToolKind, type ToolResultLike } from "./tool-rows.js"

/** Mirrors pi-core's `CodemodeNestedCall`; every field is optional so older hosts degrade quietly. */
export type NestedCall = {
	id?: string
	name?: string
	/** Compact JSON of the arguments, truncated by the host at 200 chars (may not parse). */
	args?: string
	status?: "running" | "ok" | "error" | "cancelled"
	durationMs?: number
	error?: string
	cost?: number
}

const KINDS: ReadonlySet<string> = new Set<ToolKind>(["bash", "read", "edit", "write", "grep", "find", "ls"])
const SCRIPT_HEADER = /^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n?/
/** Argument keys toolItem() reads, in the order it prefers them. */
const ITEM_KEYS = ["command", "path", "file_path", "target_directory", "pattern"] as const

export function nestedCalls(result: ToolResultLike | undefined): NestedCall[] {
	const calls = (result?.details as { calls?: unknown } | undefined)?.calls
	if (!Array.isArray(calls)) return []
	return calls.filter((call): call is NestedCall => Boolean(call) && typeof call === "object")
}

/** Script output without pi-core's "Script completed / Wall time / Output:" header. */
export function scriptOutput(result: ToolResultLike | undefined): string {
	return resultText(result).replace(SCRIPT_HEADER, "").trim()
}

/**
 * Parse the host's argument preview. Complete JSON parses directly; a preview cut at 200 chars
 * still yields the first string value of each known key, which is all a one-line row needs.
 */
export function parseArgs(args: string | undefined): Record<string, unknown> {
	if (!args) return {}
	try {
		const value = JSON.parse(args) as unknown
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
	} catch {
		const out: Record<string, unknown> = {}
		const pair = /"([A-Za-z_$][\w$]*)":(?:"((?:[^"\\]|\\.)*)"?|(-?\d+(?:\.\d+)?|true|false|null))/g
		for (const m of args.matchAll(pair)) {
			if (m[1] in out) continue
			if (m[2] !== undefined) out[m[1]] = unescape(m[2])
			else if (m[3] !== undefined) out[m[1]] = JSON.parse(m[3])
		}
		return out
	}
}

function unescape(raw: string): string {
	// A cut can land inside an escape; drop a dangling backslash so JSON.parse accepts the rest.
	const safe = raw.replace(/\\(u[0-9a-fA-F]{0,3})?$/, "")
	try {
		return JSON.parse(`"${safe}"`) as string
	} catch {
		return safe
	}
}

function scalar(value: unknown): string | undefined {
	if (typeof value === "string") return value.split("\n")[0]?.trim()
	if (typeof value === "number" || typeof value === "boolean") return String(value)
	return undefined
}

/**
 * The item column of a nested call. Built-in tools read exactly like their top-level rows
 * (`bash` shows its command, `read` a short path). Other tools show up to three scalar
 * arguments as `key=value`, strings unquoted, instead of raw JSON.
 */
export function nestedItem(call: NestedCall): string {
	const name = call.name ?? "tool"
	const args = parseArgs(call.args)
	if (KINDS.has(name)) {
		const picked: Record<string, unknown> = {}
		for (const key of ITEM_KEYS) if (key in args) picked[key] = args[key]
		return toolItem(name as ToolKind, picked)
	}
	const parts: string[] = []
	for (const [key, value] of Object.entries(args)) {
		const shown = scalar(value)
		if (shown === undefined || shown === "") continue
		parts.push(`${key}=${shown}`)
		if (parts.length === 3) break
	}
	return parts.join(" ")
}

/** `3 calls · plan_tracker ×2, bash` — names in first-call order with repeat counts. */
export function callSummary(calls: readonly NestedCall[]): string {
	if (calls.length === 0) return "script"
	const counts = new Map<string, number>()
	for (const call of calls) counts.set(call.name ?? "tool", (counts.get(call.name ?? "tool") ?? 0) + 1)
	const names = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ")
	return `${calls.length} call${calls.length === 1 ? "" : "s"} · ${names}`
}

export type CodemodeOutcome = { text: string; failed: boolean; errorLine?: string }

/** Right-hand outcome of the parent row, and the line shown under it when something failed. */
export function codemodeOutcome(
	result: ToolResultLike | undefined,
	isError: boolean,
	durationMs: number | undefined,
): CodemodeOutcome {
	const calls = nestedCalls(result)
	const output = scriptOutput(result)
	const failedCalls = calls.filter((call) => call.status === "error")
	const dur = formatDuration(durationMs)
	const join = (...parts: string[]) => parts.filter(Boolean).join(" · ")
	if (isError || failedCalls.length > 0) {
		const label = failedCalls.length > 0 ? `${failedCalls.length} failed` : "failed"
		const scriptError = /Script error:\s*(.*)/.exec(output)?.[1]
		const errorLine = firstLine(failedCalls[0]?.error ?? "") ?? scriptError ?? firstLine(output)
		return { text: join(label, dur), failed: true, errorLine }
	}
	const lines = output ? output.split("\n").filter((line) => line.length > 0).length : 0
	return { text: join(lines === 0 ? "ok" : `${lines} line${lines === 1 ? "" : "s"}`, dur), failed: false }
}
