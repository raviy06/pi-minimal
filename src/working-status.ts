import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

export type WorkingPhase = "idle" | "thinking" | "tool" | "writing"

export type WorkingSnapshot = {
  phase: WorkingPhase
  startedAt: number
  now: number
  thought?: string
  tool?: string
  toolCount?: number
}

type ToolArgs = {
  command?: unknown
  path?: unknown
  file_path?: unknown
  target_directory?: unknown
  pattern?: unknown
}

type ContentPart = {
  type?: string
  thinking?: string
  text?: string
}

const DETAIL_MAX = 120

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function clipDetail(text: string, max = DETAIL_MAX): string {
  const one = text.replace(/\s+/g, " ").trim()
  if (one.length <= max) return one
  if (max <= 1) return "…"
  return `${one.slice(0, max - 1).trimEnd()}…`
}

export function lastThoughtLine(message: { content?: ContentPart[] } | undefined): string | undefined {
  if (!Array.isArray(message?.content)) return undefined
  let thinking = ""
  for (const part of message.content) {
    if (part?.type === "thinking" && typeof part.thinking === "string") {
      thinking = part.thinking
    }
  }
  const lines = thinking
    .split("\n")
    .map((line) => line.replace(/^[#>*\-\d.\s]+/, "").trim())
    .filter((line) => line.length > 2)
  if (lines.length === 0) return undefined
  return clipDetail(lines.slice(-2).join(" · "))
}

export function summarizeTool(name: string, args: ToolArgs | undefined): string {
  const path =
    (typeof args?.path === "string" && args.path) ||
    (typeof args?.file_path === "string" && args.file_path) ||
    (typeof args?.target_directory === "string" && args.target_directory) ||
    ""
  const pattern = typeof args?.pattern === "string" ? args.pattern : ""
  const command = typeof args?.command === "string" ? args.command.split("\n")[0]?.trim() ?? "" : ""
  const base = path.split("/").filter(Boolean).slice(-2).join("/") || path

  switch (name) {
    case "bash":
      return command ? `Running ${clipDetail(command, 56)}` : "Running"
    case "read":
      return base ? `Reading ${base}` : "Reading"
    case "edit":
      return base ? `Editing ${base}` : "Editing"
    case "write":
      return base ? `Writing ${base}` : "Writing"
    case "grep":
      return pattern ? `Grep ${clipDetail(pattern, 40)}` : "Grep"
    case "find":
      return pattern ? `Finding ${clipDetail(pattern, 40)}` : "Finding"
    case "ls":
      return base ? `Listing ${base}` : "Listing"
    default:
      return name || "Working"
  }
}

export function formatWorkingMessage(snap: WorkingSnapshot): string {
  const elapsed = formatElapsed(snap.now - snap.startedAt)
  if (snap.phase === "tool" && snap.tool) {
    const extra = snap.toolCount && snap.toolCount > 1 ? ` · ${snap.toolCount} tools` : ""
    return `${snap.tool}${extra} · ${elapsed}`
  }
  if (snap.phase === "writing") return `Writing · ${elapsed}`
  if (snap.thought) return `Thinking · ${snap.thought} · ${elapsed}`
  return `Thinking · ${elapsed}`
}

export function installWorkingStatus(pi: ExtensionAPI): () => void {
  let ctx: ExtensionContext | undefined
  let startedAt = 0
  let phase: WorkingPhase = "idle"
  let thought: string | undefined
  let lastMessage = ""
  let timer: ReturnType<typeof setInterval> | undefined
  const tools = new Map<string, string>()

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = undefined
    startedAt = 0
    phase = "idle"
    thought = undefined
    lastMessage = ""
    tools.clear()
    if (ctx?.mode === "tui") ctx.ui.setWorkingMessage()
  }

  const paint = (now = Date.now()) => {
    if (!ctx || ctx.mode !== "tui" || phase === "idle") return
    const next = formatWorkingMessage({
      phase,
      startedAt,
      now,
      thought,
      tool: [...tools.values()].at(-1),
      toolCount: tools.size,
    })
    if (next === lastMessage) return
    lastMessage = next
    ctx.ui.setWorkingMessage(next)
  }

  const startClock = () => {
    if (!startedAt) startedAt = Date.now()
    if (!timer) timer = setInterval(() => paint(), 1000)
  }

  pi.on("session_start", (_event, next) => {
    if (next.mode !== "tui") return
    ctx = next
  })

  pi.on("agent_start", () => {
    if (!ctx || ctx.mode !== "tui") return
    if (phase === "idle") {
      tools.clear()
      thought = undefined
      lastMessage = ""
      startedAt = Date.now()
    }
    if (tools.size === 0) phase = "thinking"
    startClock()
    paint()
  })

  pi.on("turn_start", () => {
    if (phase === "idle") return
    if (tools.size === 0) phase = "thinking"
    startClock()
    paint()
  })

  pi.on("message_update", (event) => {
    if (phase === "idle") return
    const ev = event as {
      message?: { role?: string; content?: ContentPart[] }
      assistantMessageEvent?: { type?: string }
    }
    if (ev.message?.role && ev.message.role !== "assistant") return
    const kind = ev.assistantMessageEvent?.type
    const nextThought = lastThoughtLine(ev.message)
    if (nextThought) thought = nextThought
    if (kind === "text_start" || kind === "text_delta" || kind === "text_end") {
      if (tools.size === 0) phase = "writing"
    } else if (tools.size === 0) {
      phase = "thinking"
    }
    paint()
  })

  pi.on("tool_execution_start", (event) => {
    if (phase === "idle") return
    const ev = event as { toolCallId?: string; toolName?: string; args?: ToolArgs }
    const id = ev.toolCallId || `${ev.toolName}-${tools.size}`
    tools.set(id, summarizeTool(ev.toolName || "tool", ev.args))
    phase = "tool"
    paint()
  })

  pi.on("tool_execution_end", (event) => {
    if (phase === "idle") return
    const ev = event as { toolCallId?: string }
    if (ev.toolCallId) tools.delete(ev.toolCallId)
    phase = tools.size > 0 ? "tool" : "thinking"
    paint()
  })

  pi.on("agent_settled", () => {
    stop()
  })

  pi.on("session_shutdown", () => {
    ctx = undefined
    stop()
  })

  return stop
}
