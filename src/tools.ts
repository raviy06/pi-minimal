import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent"
import { Container, truncateToWidth } from "@earendil-works/pi-tui"
import { rowIsRunning } from "./activity.js"
import { chromeMargin } from "./chrome.js"
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
const rowIndent = () => chromeMargin() + 1
/** Max lines of output shown when a row is expanded. */
const EXPANDED_MAX_LINES = 400

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
      const errorLine = errorLineBlock(renderContext.state.outcome?.errorLine, theme)
      if (errorLine && !(options as RenderOptions).expanded) container.addChild(errorLine)
      if ((options as RenderOptions).expanded) container.addChild(outputBlock(kind, typedResult, theme))
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
    if (!isToolKind(toolName)) return next()
    return compactRenderers(toolName)
  })
}
