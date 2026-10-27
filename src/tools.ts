import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent"
import { Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import { rowIsRunning } from "./activity.js"
import * as chrome from "./chrome.js"
import { callSummary, codemodeOutcome, nestedCalls, nestedItem, scriptOutput, type NestedCall } from "./codemode-rows.js"
import { diffWords } from "diff"
import type { EditDiffMode } from "./config.js"
import { createLiveWatch } from "./live-watch.js"
import {
  bashBody,
  formatDuration,
  formatOutcome,
  layoutRow,
  resultText,
  rowGlyph,
  toolItem,
  type Outcome,
  type RowStatus,
  type ToolArgs,
  type ToolKind,
  type ToolResultLike,
} from "./tool-rows.js"

/** Tolerates a stale chrome module after /reload, where only CHROME_MARGIN may exist. */
const margin = (): number => (typeof chrome.chromeMargin === "function" ? chrome.chromeMargin() : (chrome.CHROME_MARGIN ?? 1))

type RenderOptions = {
  expanded?: boolean
}

type RowState = {
  done?: boolean
  running?: boolean
  startedAt?: number
  outcome?: Outcome
}

type RenderContext = {
  isPartial?: boolean
  isError?: boolean
  invalidate: () => void
  state: RowState
  args?: ToolArgs
  toolCallId?: string
  expanded?: boolean
  durationMs?: number
  outputPad?: number
}

const live = createLiveWatch(400)

/** Left indent of every tool row: chrome margin plus one cell so rows sit inside message text. */
const rowIndent = () => margin() + 1
/** Max lines of output shown when a row is expanded. */
const EXPANDED_MAX_LINES = 400
/** Max diff lines shown inline under an edit row with `editDiff: "always"`; ctrl+o shows the rest. */
const INLINE_DIFF_MAX_LINES = 40

let editDiffMode: EditDiffMode = "expanded"

/** Applies the `editDiff` setting; read at session start, so a change needs a new session or /reload. */
export function setEditDiffMode(mode: EditDiffMode): void {
  editDiffMode = mode
}

export function stopLiveWatch(): void {
  live.stop()
}

function liveId(context: RenderContext, item: string): string {
  return context.toolCallId || item
}

function rowStatus(context: RenderContext): RowStatus {
  if (context.isError) return "error"
  if (context.state.outcome?.errorLine) return "error"
  return rowIsRunning(context) ? "running" : "ok"
}

function statusColor(status: RowStatus): "error" | "warning" | "success" {
  if (status === "error") return "error"
  if (status === "running") return "warning"
  return "success"
}

function expandedLines(kind: ToolKind, result: ToolResultLike | undefined): string[] {
  let text = resultText(result)
  if (kind === "bash") text = bashBody(text).body
  if (!text) return []
  const lines = text.split("\n")
  if (lines.length > EXPANDED_MAX_LINES) {
    const hidden = lines.length - EXPANDED_MAX_LINES
    return [...lines.slice(0, EXPANDED_MAX_LINES), `… ${hidden} more lines`]
  }
  return lines
}

function outputBlock(kind: ToolKind, result: ToolResultLike | undefined, theme: Theme) {
  const lines = expandedLines(kind, result)
  if (lines.length === 0) return new Container()
  const indent = " ".repeat(rowIndent() + 2)
  const rule = theme.fg("borderMuted", "│")
  return {
    render(width: number): string[] {
      const inner = Math.max(0, width - indent.length - 2)
      return lines.map((line) => `${indent}${rule} ${theme.fg("dim", truncateToWidth(line, inner))}`)
    },
    invalidate() {},
  }
}

function editDiffText(result: ToolResultLike | undefined): string | undefined {
  const details = result?.details as { diff?: unknown } | undefined
  return typeof details?.diff === "string" && details.diff.trim() ? details.diff : undefined
}

type DiffLine = { prefix: "+" | "-" | " "; lineNum: string; content: string }

/** pi's edit diff lines: "+123 content", "-123 content", " 123 context"; anything else (e.g. "...") is a separator. */
function parseDiffLine(line: string): DiffLine | undefined {
  const match = /^([+\- ])(\s*\d*) (.*)$/.exec(line)
  if (!match) return undefined
  return { prefix: match[1] as DiffLine["prefix"], lineNum: match[2]!, content: match[3]!.replace(/\t/g, "   ") }
}

/** Word-level diff of a 1:1 replacement; changed tokens are inverted, leading indentation is left alone, as in pi. */
function highlightPair(removed: string, added: string, theme: Theme): { removed: string; added: string } {
  let out = { removed: "", added: "" }
  let firstRemoved = true
  let firstAdded = true
  for (const part of diffWords(removed, added)) {
    if (part.removed || part.added) {
      const key = part.removed ? "removed" : "added"
      let value = part.value
      if (part.removed ? firstRemoved : firstAdded) {
        const ws = /^(\s*)/.exec(value)?.[1] ?? ""
        value = value.slice(ws.length)
        out = { ...out, [key]: out[key] + ws }
        if (part.removed) firstRemoved = false
        else firstAdded = false
      }
      if (value) out = { ...out, [key]: out[key] + theme.inverse(value) }
    } else {
      out = { removed: out.removed + part.value, added: out.added + part.value }
    }
  }
  return out
}

/** Colours pi's edit diff like pi does: theme diff colours per line, inverse on changed tokens of single-line replacements. */
function colorDiffLines(lines: string[], theme: Theme): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; ) {
    const parsed = parseDiffLine(lines[i]!)
    if (!parsed) { out.push(theme.fg("toolDiffContext", lines[i]!)); i++; continue }
    if (parsed.prefix === " ") { out.push(theme.fg("toolDiffContext", ` ${parsed.lineNum} ${parsed.content}`)); i++; continue }
    const removed: DiffLine[] = []
    const added: DiffLine[] = []
    for (let p = parseDiffLine(lines[i] ?? ""); p?.prefix === "-"; p = parseDiffLine(lines[++i] ?? "")) removed.push(p)
    for (let p = parseDiffLine(lines[i] ?? ""); p?.prefix === "+"; p = parseDiffLine(lines[++i] ?? "")) added.push(p)
    if (removed.length === 1 && added.length === 1) {
      const pair = highlightPair(removed[0]!.content, added[0]!.content, theme)
      out.push(theme.fg("toolDiffRemoved", `-${removed[0]!.lineNum} ${pair.removed}`))
      out.push(theme.fg("toolDiffAdded", `+${added[0]!.lineNum} ${pair.added}`))
      continue
    }
    for (const line of removed) out.push(theme.fg("toolDiffRemoved", `-${line.lineNum} ${line.content}`))
    for (const line of added) out.push(theme.fg("toolDiffAdded", `+${line.lineNum} ${line.content}`))
  }
  return out
}

/** The edit's diff in the `│`-ruled block. Inline views are capped; expanded views show up to the usual limit. */
function diffBlock(diff: string, theme: Theme, expanded: boolean) {
  const all = diff.replace(/\n$/, "").split("\n")
  const max = expanded ? EXPANDED_MAX_LINES : INLINE_DIFF_MAX_LINES
  const lines = colorDiffLines(all.length > max ? all.slice(0, max) : all, theme)
  const hidden = all.length - lines.length
  const indent = " ".repeat(rowIndent() + 2)
  const rule = theme.fg("borderMuted", "│")
  return {
    render(width: number): string[] {
      const inner = Math.max(0, width - indent.length - 2)
      const out = lines.map((line) => `${indent}${rule} ${truncateToWidth(line, inner)}`)
      if (hidden > 0) out.push(`${indent}${rule} ${theme.fg("dim", `… ${hidden} more lines${expanded ? "" : " (ctrl+o)"}`)}`)
      return out
    },
    invalidate() {},
  }
}

function errorLineBlock(line: string | undefined, theme: Theme) {
  if (!line) return undefined
  const indent = " ".repeat(rowIndent() + 2)
  const rule = theme.fg("error", "│")
  return {
    render(width: number): string[] {
      const inner = Math.max(0, width - indent.length - 2)
      return [`${indent}${rule} ${theme.fg("error", truncateToWidth(line, inner))}`]
    },
    invalidate() {},
  }
}

function activityRow(kind: ToolKind, args: ToolArgs | undefined, theme: Theme, context: RenderContext) {
  const item = toolItem(kind, args)
  const id = liveId(context, item)
  const running = rowIsRunning(context)
  context.state.running = running
  if (running) {
    context.state.startedAt ??= Date.now()
    live.watch(id, context.invalidate)
  } else {
    live.unwatch(id)
  }
  return {
    render(width: number): string[] {
      const status = rowStatus(context)
      const blink = status === "running" && live.has(id)
      const glyph = rowGlyph(status, blink ? live.frame : 0)
      const outcome = context.state.outcome
      const diff = status !== "running" ? outcome?.diff : undefined
      let right = ""
      if (status === "running") {
        const started = context.state.startedAt
        right = started ? formatDuration(Date.now() - started) : ""
      } else if (outcome) {
        right = outcome.text
        if (diff) {
          const stats = `+${diff.added} −${diff.removed}`
          right = right ? `${stats} · ${right}` : stats
        }
      }
      const inner = Math.max(8, width - rowIndent())
      const row = layoutRow(inner, kind, item, right)

      let coloredRight: string
      if (status === "running") coloredRight = theme.fg("warning", row.outcome)
      else if (status === "error") coloredRight = theme.fg("error", row.outcome)
      else if (diff && row.outcome) {
        const rest = row.outcome.slice(`+${diff.added} −${diff.removed}`.length)
        coloredRight =
          theme.fg("success", `+${diff.added}`) + " " + theme.fg("error", `−${diff.removed}`) + theme.fg("dim", rest)
      } else coloredRight = theme.fg("dim", row.outcome)

      const line =
        " ".repeat(rowIndent()) +
        theme.fg(statusColor(status), glyph) +
        " " +
        theme.fg("dim", row.verb) +
        " " +
        theme.fg(status === "error" ? "text" : "muted", row.item) +
        " ".repeat(row.gap) +
        coloredRight
      return [line]
    },
    invalidate() {},
  }
}

const TOOL_KINDS: ReadonlySet<string> = new Set<ToolKind>(["bash", "read", "edit", "write", "grep", "find", "ls"])

export function isToolKind(name: string): name is ToolKind {
  return TOOL_KINDS.has(name)
}

export function compactRenderers(kind: ToolKind): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      return activityRow(kind, args as ToolArgs, theme, context as RenderContext)
    },
    renderResult(result, options, theme, context) {
      const renderContext = context as RenderContext
      const typedResult = result as ToolResultLike
      if (!renderContext.isPartial) {
        renderContext.state.done = true
        renderContext.state.running = false
        renderContext.state.outcome = formatOutcome(
          kind,
          renderContext.args,
          typedResult,
          Boolean(renderContext.isError),
          renderContext.durationMs,
        )
        live.unwatch(liveId(renderContext, toolItem(kind, renderContext.args)))
      }
      const container = new Container()
      const expanded = Boolean((options as RenderOptions).expanded)
      const errorLine = errorLineBlock(renderContext.state.outcome?.errorLine, theme)
      if (errorLine && !expanded) container.addChild(errorLine)
      const diff = kind === "edit" && !renderContext.isError && !renderContext.isPartial ? editDiffText(typedResult) : undefined
      const showDiff = diff !== undefined && (editDiffMode === "always" || (editDiffMode === "expanded" && expanded))
      if (showDiff) container.addChild(diffBlock(diff, theme, expanded))
      else if (expanded) container.addChild(outputBlock(kind, typedResult, theme))
      return container
    },
  }
}

/** One `glyph verb item … outcome` line in the tool-row grid, shared by every self-rendered row. */
function rowLine(theme: Theme, width: number, status: RowStatus, frame: 0 | 1, verb: string, item: string, right: string): string {
	const inner = Math.max(8, width - rowIndent())
	const row = layoutRow(inner, verb, item, right)
	const rightColor = status === "running" ? "warning" : status === "error" ? "error" : "dim"
	return (
		" ".repeat(rowIndent()) +
		theme.fg(statusColor(status), rowGlyph(status, frame)) +
		" " +
		theme.fg("dim", row.verb) +
		" " +
		theme.fg(status === "error" ? "text" : "muted", row.item) +
		" ".repeat(row.gap) +
		theme.fg(rightColor, row.outcome)
	)
}

/** Longest first result line shown verbatim as an outcome; longer results show a line count. */
const OUTCOME_TEXT_MAX = 24

/** `mcp` for MCP tools, `agent` for subagent tools, `tool` for anything else. */
export function genericVerb(toolName: string): string {
	if (toolName.startsWith("mcp__")) return "mcp"
	if (/subagent/.test(toolName)) return "agent"
	return "tool"
}

/** `server · tool key=value …` for MCP tools, `name key=value …` for the rest. */
export function genericItem(toolName: string, args: unknown): string {
	let json: string
	try {
		json = JSON.stringify(args ?? {}) ?? ""
	} catch {
		json = ""
	}
	const params = nestedItem({ name: toolName, args: json })
	const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName)
	const label = mcp ? `${mcp[1]} \u00b7 ${mcp[2]}` : toolName
	return params ? `${label} ${params}` : label
}

export function genericOutcome(result: ToolResultLike | undefined, isError: boolean, durationMs: number | undefined): Outcome {
	const text = resultText(result)
	const dur = formatDuration(durationMs)
	const join = (...parts: string[]) => parts.filter(Boolean).join(" \u00b7 ")
	const lines = text.split("\n").filter((line) => line.trim().length > 0)
	if (isError) return { text: join("failed", dur), errorLine: lines[0]?.trim() ?? "" }
	if (lines.length === 0) return { text: join("ok", dur) }
	const first = lines[0].trim()
	if (lines.length === 1 && visibleWidth(first) <= OUTCOME_TEXT_MAX) return { text: join(first, dur) }
	return { text: join(`${lines.length} line${lines.length === 1 ? "" : "s"}`, dur) }
}

/**
 * A one-line row for tools that bring no renderer of their own (most MCP tools,
 * `subagents_enable`): `\u2713 mcp   re_mcp \u00b7 query_prometheus query=\u2026   12 lines \u00b7 1.4s`.
 * Without it they fall through to pi-core's default: bold name, JSON arguments, a text preview.
 */
export function genericRenderers(toolName: string): ToolRenderers {
	const verb = genericVerb(toolName)
	return {
		renderShell: "self",
		renderCall(args, theme, rawContext) {
			const context = rawContext as RenderContext
			const id = context.toolCallId || toolName
			const item = genericItem(toolName, args)
			const running = rowIsRunning(context)
			context.state.running = running
			if (running) {
				context.state.startedAt ??= Date.now()
				live.watch(id, context.invalidate)
			} else live.unwatch(id)
			return {
				render(width: number): string[] {
					const status = rowStatus(context)
					const frame = status === "running" && live.has(id) ? live.frame : 0
					const right =
						status === "running"
							? context.state.startedAt
								? formatDuration(Date.now() - context.state.startedAt)
								: ""
							: (context.state.outcome?.text ?? "")
					return [rowLine(theme, width, status, frame, verb, item, right)]
				},
				invalidate() {},
			}
		},
		renderResult(result, options, theme, rawContext) {
			const context = rawContext as RenderContext
			const typed = result as ToolResultLike
			if (!context.isPartial) {
				context.state.done = true
				context.state.running = false
				context.state.outcome = genericOutcome(typed, Boolean(context.isError), context.durationMs)
				live.unwatch(context.toolCallId || toolName)
			}
			const container = new Container()
			const expanded = Boolean((options as RenderOptions).expanded)
			const errorLine = context.state.outcome?.errorLine
			if (errorLine && !expanded) container.addChild(errorLineBlock(errorLine, theme)!)
			if (expanded) {
				const text = resultText(typed)
				if (text) {
					const indent = " ".repeat(rowIndent() + 2)
					container.addChild({ render: (width: number) => ruledLines(text, width, theme, indent), invalidate() {} })
				}
			}
			return container
		},
	}
}

/** True when a tool definition draws its own call or result. */
function hasOwnRenderer(definition: ToolRenderers | undefined): boolean {
	return typeof definition?.renderCall === "function" || typeof definition?.renderResult === "function"
}

/** Max nested calls shown under a collapsed codemode row; the rest are counted. */
const NESTED_PREVIEW = 8
/** Width of the nested tool-name column. */
const NESTED_NAME_MAX = 14

type CodemodeState = RowState & { calls?: NestedCall[]; output?: string; code?: string }

function nestedGlyph(call: NestedCall, frame: 0 | 1): { glyph: string; color: "error" | "warning" | "success" | "dim" } {
	if (call.status === "running") return { glyph: rowGlyph("running", frame), color: "warning" }
	if (call.status === "error") return { glyph: "\u2717", color: "error" }
	if (call.status === "cancelled") return { glyph: "\u2298", color: "dim" }
	return { glyph: "\u2713", color: "success" }
}

/** Lines of a `\u2502`-ruled block, dim and truncated, for script source or output on expand. */
function ruledLines(text: string, width: number, theme: Theme, indent: string, label?: string): string[] {
	const inner = Math.max(0, width - indent.length - 2)
	const rule = theme.fg("borderMuted", "\u2502")
	let lines = text.split("\n")
	if (lines.length > EXPANDED_MAX_LINES) lines = [...lines.slice(0, EXPANDED_MAX_LINES), `\u2026 ${lines.length - EXPANDED_MAX_LINES} more lines`]
	const out = label ? [`${indent}${rule} ${theme.fg("dim", truncateToWidth(label, inner))}`] : []
	return out.concat(lines.map((line) => `${indent}${rule} ${theme.fg("dim", truncateToWidth(line, inner))}`))
}

/**
 * codemode as a tool row: `\u2713 code  3 calls \u00b7 plan_tracker \u00d72, bash \u2026 54 lines \u00b7 1.2s`, then one
 * child row per nested call. The script and its output appear only when expanded, undecorated,
 * so syntax colours never compete with status colours in the transcript.
 */
export function codemodeRenderers(): ToolRenderers {
	return {
		renderShell: "self",
		renderCall(args, theme, rawContext) {
			const context = rawContext as RenderContext & { state: CodemodeState }
			const code = typeof (args as { code?: unknown })?.code === "string" ? ((args as { code: string }).code) : ""
			context.state.code = code
			const id = context.toolCallId || "codemode"
			const running = rowIsRunning(context)
			context.state.running = running
			if (running) {
				context.state.startedAt ??= Date.now()
				live.watch(id, context.invalidate)
			} else live.unwatch(id)
			return {
				render(width: number): string[] {
					const state = context.state
					const status: RowStatus = state.outcome?.errorLine !== undefined || context.isError ? "error" : rowIsRunning(context) ? "running" : "ok"
					const frame = status === "running" && live.has(id) ? live.frame : 0
					const calls = state.calls ?? []
					const right =
						status === "running" ? (state.startedAt ? formatDuration(Date.now() - state.startedAt) : "") : (state.outcome?.text ?? "")
					const lines = [rowLine(theme, width, status, frame, "code", callSummary(calls), right)]
					const expanded = Boolean(context.expanded)
					const shown = expanded ? calls : calls.slice(-NESTED_PREVIEW)
					const childIndent = " ".repeat(rowIndent() + 4)
					if (shown.length < calls.length) {
						lines.push(`${childIndent}${theme.fg("dim", `\u2026 ${calls.length - shown.length} earlier calls`)}`)
					}
					const nameWidth = Math.min(NESTED_NAME_MAX, Math.max(0, ...shown.map((call) => (call.name ?? "tool").length)))
					for (const call of shown) {
						const { glyph, color } = nestedGlyph(call, frame)
						const name = truncateToWidth(call.name ?? "tool", nameWidth, "\u2026").padEnd(nameWidth)
						const dur = call.status === "error" ? `failed \u00b7 ${formatDuration(call.durationMs)}` : formatDuration(call.durationMs)
						const room = Math.max(8, width - childIndent.length)
						// Reuse the row grid with the name as the "verb" column, then fix the glyph slot.
						const prefixWidth = 2 + nameWidth + 1
						const itemRoom = Math.max(0, room - prefixWidth - (dur ? visibleWidth(dur) + 2 : 0))
						const item = truncateToWidth(nestedItem(call), itemRoom, "\u2026")
						const gap = dur ? Math.max(2, room - prefixWidth - visibleWidth(item) - visibleWidth(dur)) : 0
						lines.push(
							childIndent +
								theme.fg(color, glyph) +
								" " +
								theme.fg("dim", name) +
								" " +
								theme.fg(call.status === "error" ? "text" : "muted", item) +
								" ".repeat(gap) +
								theme.fg(call.status === "error" ? "error" : "dim", dur),
						)
					}
					return lines
				},
				invalidate() {},
			}
		},
		renderResult(result, options, theme, rawContext) {
			const context = rawContext as RenderContext & { state: CodemodeState }
			const typed = result as ToolResultLike
			context.state.calls = nestedCalls(typed)
			if (!context.isPartial) {
				context.state.done = true
				context.state.running = false
				const outcome = codemodeOutcome(typed, Boolean(context.isError), context.durationMs)
				context.state.outcome = { text: outcome.text, errorLine: outcome.failed ? (outcome.errorLine ?? "") : undefined }
				context.state.output = scriptOutput(typed)
				live.unwatch(context.toolCallId || "codemode")
			}
			// No invalidate here: the host runs renderCall and renderResult in one updateDisplay() and
			// paints afterwards, so the call row's lazy render() already sees these calls. Calling
			// invalidate() would re-enter updateDisplay() and recurse.
			const container = new Container()
			const expanded = Boolean((options as RenderOptions).expanded)
			const errorLine = context.state.outcome?.errorLine
			if (errorLine && !expanded) container.addChild(errorLineBlock(errorLine, theme)!)
			if (expanded) {
				const indent = " ".repeat(rowIndent() + 4)
				const code = context.state.code ?? ""
				const output = context.state.output ?? ""
				container.addChild({
					render(width: number): string[] {
						const lines: string[] = []
						if (code) lines.push(...ruledLines(code.trimEnd(), width, theme, indent, `// script \u00b7 ${code.trimEnd().split("\n").length} lines`))
						if (output) lines.push(...ruledLines(output, width, theme, indent, "// output"))
						return lines
					},
					invalidate() {},
				})
			}
			return container
		},
	}
}

/**
 * Attach the compact renderers to the built-in tools without re-registering them. Registered at
 * extension load so a resumed transcript draws its earlier tool calls the same way as new ones.
 */
export function installToolRenderers(pi: ExtensionAPI): void {
  if (typeof pi.registerToolRenderer !== "function") return
  pi.registerToolRenderer((toolName, next) => {
    if (toolName === "codemode") return codemodeRenderers()
    if (isToolKind(toolName)) return compactRenderers(toolName)
    // Tools that draw themselves (subagent's live view, gauntlet's trackers) keep their look.
    const definition = next()
    if (hasOwnRenderer(definition)) return definition
    return { ...definition, ...genericRenderers(toolName) }
  })
}
