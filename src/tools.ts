import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui"
import { activityBullet, rowIsRunning } from "./activity.js"
import { createLiveWatch } from "./live-watch.js"
import { nextGroupedRow, toolItem, type ToolKind } from "./tool-rows.js"

type ToolArgs = {
  command?: unknown
  path?: unknown
  file_path?: unknown
  pattern?: unknown
  target_directory?: unknown
}

type ToolResult = {
  content?: Array<{ type?: string; text?: string }>
}

type RenderOptions = {
  expanded?: boolean
}

type RowState = {
  done?: boolean
  running?: boolean
}

type RenderContext = {
  isPartial?: boolean
  isError?: boolean
  invalidate: () => void
  state: RowState
  args?: ToolArgs
  toolCallId?: string
  expanded?: boolean
}

let live = createLiveWatch(400)

export function stopLiveWatch(): void {
  live.stop()
}

function liveId(context: RenderContext, item: string): string {
  return context.toolCallId || item
}

function contentText(result: ToolResult | undefined): string {
  if (!result?.content) return ""
  return result.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
}

function collapsedResult() {
  return new Container()
}

function expandedContent(result: ToolResult | undefined, options: RenderOptions) {
  if (!options.expanded) return collapsedResult()
  const text = contentText(result)
  return text ? new Text(text, 0, 0) : collapsedResult()
}

function activityBlock(
  kind: ToolKind,
  args: ToolArgs | undefined,
  theme: Theme,
  context: RenderContext,
) {
  const item = toolItem(kind, args)
  const id = liveId(context, item)
  const row = nextGroupedRow(kind, item, id)
  const running = rowIsRunning(context)
  context.state.running = running
  if (running) live.watch(id, context.invalidate)
  else live.unwatch(id)
  const color = context.isError ? "error" : running ? "warning" : "dim"
  return {
    render(width: number): string[] {
      const pad = 1
      const inner = Math.max(0, width - pad)
      const lines: string[] = []
      if (row.header) {
        const blink = Boolean(context.state.running) && live.has(id)
        const bullet = activityBullet(blink, live.frame)
        lines.push(" ".repeat(pad) + theme.fg(color, truncateToWidth(`${bullet} ${row.header}`, inner)))
      }
      lines.push(" ".repeat(pad) + "  " + theme.fg(color, truncateToWidth(row.item, Math.max(0, inner - 2))))
      return lines
    },
    invalidate() {},
  }
}

function wrapOne(
  pi: ExtensionAPI,
  kind: ToolKind,
  factory: () => any,
) {
  try {
    const tool = factory()
    pi.registerTool({
      ...tool,
      renderShell: "self",
      renderCall(args, theme, context) {
        return activityBlock(kind, args as ToolArgs, theme, context as RenderContext)
      },
      renderResult(result, options, _theme, context) {
        const renderContext = context as RenderContext
        if (!renderContext.isPartial) {
          renderContext.state.done = true
          renderContext.state.running = false
          live.unwatch(liveId(renderContext, toolItem(kind, renderContext.args)))
        }
        return expandedContent(result as ToolResult, options)
      },
    })
  } catch {}
}

export function wrapBuiltinTools(pi: ExtensionAPI, ctx: ExtensionContext): void {
  let commandPrefix: string | undefined
  let shellPath: string | undefined
  let autoResizeImages: boolean | undefined
  try {
    const settings = SettingsManager.create(ctx.cwd)
    commandPrefix = settings.getShellCommandPrefix()
    shellPath = settings.getShellPath()
    autoResizeImages = settings.getImageAutoResize()
  } catch {}

  wrapOne(pi, "bash", () => createBashToolDefinition(ctx.cwd, { commandPrefix, shellPath }))
  wrapOne(pi, "read", () => createReadToolDefinition(ctx.cwd, { autoResizeImages }))
  wrapOne(pi, "edit", () => createEditToolDefinition(ctx.cwd))
  wrapOne(pi, "write", () => createWriteToolDefinition(ctx.cwd))
  wrapOne(pi, "grep", () => createGrepToolDefinition(ctx.cwd))
  wrapOne(pi, "find", () => createFindToolDefinition(ctx.cwd))
  wrapOne(pi, "ls", () => createLsToolDefinition(ctx.cwd))
}
