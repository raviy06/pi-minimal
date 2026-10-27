import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent"
import { Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import { rowIsRunning } from "./activity.js"
import * as chrome from "./chrome.js"
import { callSummary, codemodeOutcome, nestedCalls, nestedItem, scriptOutput, type NestedCall } from "./codemode-rows.js"
import type { EditDiffMode } from "./config.js"
import { colorDiffLines, editDiffText } from "./edit-diff.js"
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

type Component = { render(width: number): string[]; invalidate(): void }

type RenderOptions = { expanded?: boolean }

export type RowState = {
  done?: boolean
  running?: boolean
  startedAt?: number
  outcome?: Outcome
  /** Key of this row's live spinner subscription, fixed at the first render. */
  liveId?: string
  /** Strategy-private data captured from the call or result (codemode keeps its nested calls here). */
  extra?: unknown
}

export type RenderContext = {
  isPartial?: boolean
  isError?: boolean
  invalidate: () => void
  state: RowState
  args?: unknown
  toolCallId?: string
  expanded?: boolean
  durationMs?: number
}

/**
 * What differs between tool rows. `createRowRenderers` owns everything else: running state, the
 * live spinner keyed by tool call, status colouring, the error line under a failed row, and the
 * expand/collapse plumbing.
 */
export type RowStrategy = {
  verb: string
  /** The row's subject; may read `state` when it depends on the result (codemode's call summary). */
  item(args: unknown, state: RowState): string
  /** Called when the result lands (partial or final) before anything renders. */
  onResult?(result: ToolResultLike, state: RowState): void
  outcome(args: unknown, result: ToolResultLike, isError: boolean, durationMs: number | undefined): Outcome
  /** Lines drawn under the call row itself, every frame (codemode's nested calls). */
  childLines?(state: RowState, theme: Theme, width: number, frame: 0 | 1, expanded: boolean): string[]
  /** Block under the row once the result is in. `expanded` is the ctrl+o state; return nothing to show nothing. */
  detail?(args: unknown, result: ToolResultLike, state: RowState, theme: Theme, expanded: boolean, isError: boolean): Component | undefined
  /** Indent of detail blocks relative to the row glyph (2 for plain rows, 4 under codemode's child rows). */
  detailIndent?: number
}

const live = createLiveWatch(400)

/** Left indent of every tool row: chrome margin plus one cell so rows sit inside message text. */
const rowIndent = () => margin() + 1
/** Max lines of output shown when a row is expanded. */
const EXPANDED_MAX_LINES = 400
/** Max diff lines shown inline under an edit row with `editDiff: "always"`; ctrl+o shows the rest. */
const INLINE_DIFF_MAX_LINES = 40
/** With `editDiff: "expanded"`, diffs this short are shown inline anyway: hiding them saves nothing. */
const SMALL_DIFF_MAX_LINES = 8

let editDiffMode: EditDiffMode = "expanded"

/** Applies the `editDiff` setting; read at session start, so a change needs a new session or /reload. */
export function setEditDiffMode(mode: EditDiffMode): void {
  editDiffMode = mode
}

export function stopLiveWatch(): void {
  live.stop()
}

function rowStatus(context: RenderContext): RowStatus {
  if (context.isError) return "error"
  if (context.state.outcome?.errorLine !== undefined) return "error"
  return rowIsRunning(context) ? "running" : "ok"
}

function statusColor(status: RowStatus): "error" | "warning" | "success" {
  if (status === "error") return "error"
  if (status === "running") return "warning"
  return "success"
}

// ---------------------------------------------------------------------------------------------
// Blocks under a row

const ruled = (lines: string[], theme: Theme, indentCells: number, tone: "dim" | "error" | undefined = "dim"): Component => {
  const indent = " ".repeat(rowIndent() + indentCells)
  const rule = theme.fg(tone === "error" ? "error" : "borderMuted", "│")
  return {
    render(width: number): string[] {
      const inner = Math.max(0, width - indent.length - 2)
      return lines.map((line) => `${indent}${rule} ${tone ? theme.fg(tone, truncateToWidth(line, inner)) : truncateToWidth(line, inner)}`)
    },
    invalidate() {},
  }
}

function capped(lines: string[], max: number, more: (hidden: number) => string): string[] {
  if (lines.length <= max) return lines
  return [...lines.slice(0, max), more(lines.length - max)]
}

/** Plain text (output, file content, script) in the ruled block, dim, capped at the expanded limit. */
function textBlock(text: string, theme: Theme, indentCells: number, label?: string): Component | undefined {
  if (!text) return undefined
  const lines = capped(text.split("\n"), EXPANDED_MAX_LINES, (hidden) => `… ${hidden} more lines`)
  return ruled(label ? [label, ...lines] : lines, theme, indentCells)
}

/** The edit's diff in the ruled block, coloured per line; inline views are capped and point at ctrl+o. */
function diffBlock(diff: string, theme: Theme, expanded: boolean): Component {
  const all = diff.replace(/\n$/, "").split("\n")
  const max = expanded ? EXPANDED_MAX_LINES : INLINE_DIFF_MAX_LINES
  const shown = colorDiffLines(all.slice(0, max), theme)
  const hidden = all.length - shown.length
  if (hidden > 0) shown.push(theme.fg("dim", `… ${hidden} more lines${expanded ? "" : " (ctrl+o)"}`))
  return ruled(shown, theme, 2, undefined)
}

// ---------------------------------------------------------------------------------------------
// The one row lifecycle

/** `glyph verb item … outcome` on one line; an edit's `+N −M` is coloured success/error. */
function rowLine(theme: Theme, width: number, status: RowStatus, frame: 0 | 1, verb: string, item: string, outcome: Outcome | undefined, elapsed: string): string {
  const diff = status !== "running" ? outcome?.diff : undefined
  let right = status === "running" ? elapsed : (outcome?.text ?? "")
  if (diff) {
    const stats = `+${diff.added} −${diff.removed}`
    right = right ? `${stats} · ${right}` : stats
  }
  const inner = Math.max(8, width - rowIndent())
  const row = layoutRow(inner, verb, item, right)
  let coloredRight: string
  if (status === "running") coloredRight = theme.fg("warning", row.outcome)
  else if (status === "error") coloredRight = theme.fg("error", row.outcome)
  else if (diff && row.outcome) {
    const rest = row.outcome.slice(`+${diff.added} −${diff.removed}`.length)
    coloredRight = theme.fg("success", `+${diff.added}`) + " " + theme.fg("error", `−${diff.removed}`) + theme.fg("dim", rest)
  } else coloredRight = theme.fg("dim", row.outcome)
  return (
    " ".repeat(rowIndent()) +
    theme.fg(statusColor(status), rowGlyph(status, frame)) +
    " " +
    theme.fg("dim", row.verb) +
    " " +
    theme.fg(status === "error" ? "text" : "muted", row.item) +
    " ".repeat(row.gap) +
    coloredRight
  )
}

export function createRowRenderers(strategy: RowStrategy): ToolRenderers {
  const detailIndent = strategy.detailIndent ?? 2
  return {
    renderShell: "self",
    renderCall(args, theme, rawContext) {
      const context = rawContext as RenderContext
      const id = (context.state.liveId ??= context.toolCallId || `${strategy.verb}:${strategy.item(args, context.state)}`)
      const running = rowIsRunning(context)
      context.state.running = running
      if (running) {
        context.state.startedAt ??= Date.now()
        live.watch(id, context.invalidate)
      } else live.unwatch(id)
      return {
        render(width: number): string[] {
          const status = rowStatus(context)
          const frame: 0 | 1 = status === "running" && live.has(id) ? live.frame : 0
          const elapsed = context.state.startedAt ? formatDuration(Date.now() - context.state.startedAt) : ""
          const item = strategy.item(args, context.state)
          const lines = [rowLine(theme, width, status, frame, strategy.verb, item, context.state.outcome, elapsed)]
          if (strategy.childLines) lines.push(...strategy.childLines(context.state, theme, width, frame, Boolean(context.expanded)))
          return lines
        },
        invalidate() {},
      }
    },
    renderResult(result, options, theme, rawContext) {
      const context = rawContext as RenderContext
      const typed = result as ToolResultLike
      const isError = Boolean(context.isError)
      strategy.onResult?.(typed, context.state)
      if (!context.isPartial) {
        context.state.done = true
        context.state.running = false
        context.state.outcome = strategy.outcome(context.args, typed, isError, context.durationMs)
        live.unwatch(context.state.liveId ?? context.toolCallId ?? `${strategy.verb}:${strategy.item(context.args, context.state)}`)
      }
      // No invalidate here: the host runs renderCall and renderResult in one updateDisplay() and
      // paints afterwards, so the call row's lazy render() already sees this state.
      const container = new Container()
      const expanded = Boolean((options as RenderOptions).expanded)
      const errorLine = context.state.outcome?.errorLine
      if (errorLine && !expanded) container.addChild(ruled([errorLine], theme, detailIndent, "error"))
      if (!context.isPartial) {
        const detail = strategy.detail?.(context.args, typed, context.state, theme, expanded, isError)
        if (detail) container.addChild(detail)
      }
      return container
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Strategy: built-in tools (bash, read, edit, write, grep, find, ls)

const TOOL_KINDS: ReadonlySet<string> = new Set<ToolKind>(["bash", "read", "edit", "write", "grep", "find", "ls"])

export function isToolKind(name: string): name is ToolKind {
  return TOOL_KINDS.has(name)
}

/** Which edit diffs show without ctrl+o under the current setting. */
function diffShownInline(diffLines: number): boolean {
  if (editDiffMode === "always") return true
  if (editDiffMode === "expanded") return diffLines <= SMALL_DIFF_MAX_LINES
  return false
}

function compactStrategy(kind: ToolKind): RowStrategy {
  return {
    verb: kind,
    item: (args) => toolItem(kind, args as ToolArgs),
    outcome: (args, result, isError, durationMs) => formatOutcome(kind, args as ToolArgs, result, isError, durationMs),
    detail(args, result, _state, theme, expanded, isError) {
      if (kind === "edit" && !isError) {
        const diff = editDiffText(result)
        if (diff) {
          const lines = diff.replace(/\n$/, "").split("\n").length
          if (expanded ? editDiffMode !== "never" : diffShownInline(lines)) return diffBlock(diff, theme, expanded)
          if (!expanded) return undefined
        }
      }
      if (!expanded) return undefined
      if (kind === "write" && !isError) {
        const content = (args as ToolArgs | undefined)?.content
        if (typeof content === "string") return textBlock(content.replace(/\n$/, ""), theme, 2)
      }
      const text = kind === "bash" ? bashBody(resultText(result)).body : resultText(result)
      return textBlock(text, theme, 2)
    },
  }
}

export function compactRenderers(kind: ToolKind): ToolRenderers {
  return createRowRenderers(compactStrategy(kind))
}

// ---------------------------------------------------------------------------------------------
// Strategy: tools without a renderer of their own (most MCP tools, subagents_enable)

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
  const label = mcp ? `${mcp[1]} · ${mcp[2]}` : toolName
  return params ? `${label} ${params}` : label
}

export function genericOutcome(result: ToolResultLike | undefined, isError: boolean, durationMs: number | undefined): Outcome {
  const text = resultText(result)
  const dur = formatDuration(durationMs)
  const join = (...parts: string[]) => parts.filter(Boolean).join(" · ")
  const lines = text.split("\n").filter((line) => line.trim().length > 0)
  if (isError) return { text: join("failed", dur), errorLine: lines[0]?.trim() ?? "" }
  if (lines.length === 0) return { text: join("ok", dur) }
  const first = lines[0].trim()
  if (lines.length === 1 && visibleWidth(first) <= OUTCOME_TEXT_MAX) return { text: join(first, dur) }
  return { text: join(`${lines.length} line${lines.length === 1 ? "" : "s"}`, dur) }
}

/**
 * `✓ mcp   re_mcp · query_prometheus query=…   12 lines · 1.4s`. Without it such tools fall
 * through to pi-core's default: bold name, JSON arguments, a text preview.
 */
export function genericRenderers(toolName: string): ToolRenderers {
  return createRowRenderers({
    verb: genericVerb(toolName),
    item: (args) => genericItem(toolName, args),
    outcome: (_args, result, isError, durationMs) => genericOutcome(result, isError, durationMs),
    detail: (_args, result, _state, theme, expanded) => (expanded ? textBlock(resultText(result), theme, 2) : undefined),
  })
}

/** True when a tool definition draws its own call or result. */
function hasOwnRenderer(definition: ToolRenderers | undefined): boolean {
  return typeof definition?.renderCall === "function" || typeof definition?.renderResult === "function"
}

// ---------------------------------------------------------------------------------------------
// Strategy: codemode, one row per nested call

/** Max nested calls shown under a collapsed codemode row; the rest are counted. */
const NESTED_PREVIEW = 8
/** Width of the nested tool-name column. */
const NESTED_NAME_MAX = 14

type CodemodeExtra = { calls?: NestedCall[]; output?: string; code?: string }

const codemodeExtra = (state: RowState): CodemodeExtra => (state.extra ??= {}) as CodemodeExtra

function nestedGlyph(call: NestedCall, frame: 0 | 1): { glyph: string; color: "error" | "warning" | "success" | "dim" } {
  if (call.status === "running") return { glyph: rowGlyph("running", frame), color: "warning" }
  if (call.status === "error") return { glyph: "✗", color: "error" }
  if (call.status === "cancelled") return { glyph: "⊘", color: "dim" }
  return { glyph: "✓", color: "success" }
}

function nestedCallLines(calls: NestedCall[], theme: Theme, width: number, frame: 0 | 1, expanded: boolean): string[] {
  const shown = expanded ? calls : calls.slice(-NESTED_PREVIEW)
  const childIndent = " ".repeat(rowIndent() + 4)
  const lines: string[] = []
  if (shown.length < calls.length) lines.push(`${childIndent}${theme.fg("dim", `… ${calls.length - shown.length} earlier calls`)}`)
  const nameWidth = Math.min(NESTED_NAME_MAX, Math.max(0, ...shown.map((call) => (call.name ?? "tool").length)))
  for (const call of shown) {
    const { glyph, color } = nestedGlyph(call, frame)
    const name = truncateToWidth(call.name ?? "tool", nameWidth, "…").padEnd(nameWidth)
    const dur = call.status === "error" ? `failed · ${formatDuration(call.durationMs)}` : formatDuration(call.durationMs)
    const room = Math.max(8, width - childIndent.length)
    const prefixWidth = 2 + nameWidth + 1
    const itemRoom = Math.max(0, room - prefixWidth - (dur ? visibleWidth(dur) + 2 : 0))
    const item = truncateToWidth(nestedItem(call), itemRoom, "…")
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
}

/**
 * `✓ code  3 calls · plan_tracker ×2, bash … 54 lines · 1.2s`, then one child row per nested
 * call. The script and its output appear only when expanded, undecorated, so syntax colours
 * never compete with status colours in the transcript.
 */
export function codemodeRenderers(): ToolRenderers {
  return createRowRenderers({
    verb: "code",
    item: (_args, state) => callSummary(codemodeExtra(state).calls ?? []),
    detailIndent: 4,
    onResult(result, state) {
      const extra = codemodeExtra(state)
      extra.calls = nestedCalls(result)
      extra.output = scriptOutput(result)
    },
    outcome(_args, result, isError, durationMs) {
      const outcome = codemodeOutcome(result, isError, durationMs)
      return { text: outcome.text, errorLine: outcome.failed ? (outcome.errorLine ?? "") : undefined }
    },
    childLines: (state, theme, width, frame, expanded) => nestedCallLines(codemodeExtra(state).calls ?? [], theme, width, frame, expanded),
    detail(args, _result, state, theme, expanded) {
      if (!expanded) return undefined
      const code = typeof (args as { code?: unknown } | undefined)?.code === "string" ? (args as { code: string }).code.trimEnd() : ""
      const output = codemodeExtra(state).output ?? ""
      const parts = [
        code ? textBlock(code, theme, 4, `// script · ${code.split("\n").length} lines`) : undefined,
        output ? textBlock(output, theme, 4, "// output") : undefined,
      ].filter((part): part is Component => part !== undefined)
      if (parts.length === 0) return undefined
      return { render: (width) => parts.flatMap((part) => part.render(width)), invalidate() {} }
    },
  })
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

