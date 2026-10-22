import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import { CHROME_MARGIN } from "./chrome.js"
import { formatElapsed } from "./working-status.js"

export const TURN_ENTRY_TYPE = "pi-minimal.turn"

export type TurnSummary = {
  /** Epoch ms when the run finished. */
  endedAt: number
  /** Wall-clock duration of the run. */
  elapsedMs: number
  /** Number of tool executions during the run. */
  tools: number
  /** Whether the run ended with an error result or abort. */
  outcome: "completed" | "aborted" | "error"
}

export function formatClock(epochMs: number): string {
  const d = new Date(epochMs)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

export function turnLabel(summary: TurnSummary): string {
  const parts = [formatClock(summary.endedAt), formatElapsed(summary.elapsedMs)]
  if (summary.tools > 0) parts.push(`${summary.tools} tool${summary.tools === 1 ? "" : "s"}`)
  if (summary.outcome === "aborted") parts.push("aborted")
  if (summary.outcome === "error") parts.push("error")
  return parts.join(" · ")
}

/** `── label ─────────` filling `width`; label is dropped when the row is too narrow. */
export function ruleLine(width: number, label: string): string {
  const lead = "── "
  const tail = " "
  const minRule = 4
  if (width <= 0) return ""
  if (visibleWidth(lead) + visibleWidth(label) + visibleWidth(tail) + minRule > width) {
    return "─".repeat(width)
  }
  const shown = truncateToWidth(label, width - lead.length - tail.length - minRule, "…")
  const rest = Math.max(minRule, width - visibleWidth(lead) - visibleWidth(shown) - visibleWidth(tail))
  return `${lead}${shown}${tail}${"─".repeat(rest)}`
}

export function runOutcome(messages: Array<{ role?: string; stopReason?: string }> | undefined): TurnSummary["outcome"] {
  if (!Array.isArray(messages)) return "completed"
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== "assistant") continue
    if (message.stopReason === "aborted") return "aborted"
    if (message.stopReason === "error") return "error"
    return "completed"
  }
  return "completed"
}

export function isTurnSummary(data: unknown): data is TurnSummary {
  if (!data || typeof data !== "object") return false
  const d = data as Record<string, unknown>
  return (
    typeof d.endedAt === "number" &&
    typeof d.elapsedMs === "number" &&
    typeof d.tools === "number" &&
    (d.outcome === "completed" || d.outcome === "aborted" || d.outcome === "error")
  )
}

export function installTurnRule(pi: ExtensionAPI): () => void {
  let ctx: ExtensionContext | undefined
  let startedAt = 0
  let tools = 0

  if (typeof pi.registerEntryRenderer !== "function" || typeof pi.appendEntry !== "function") {
    return () => {}
  }

  pi.registerEntryRenderer<TurnSummary>(TURN_ENTRY_TYPE, (entry, _options, theme) => {
    if (!isTurnSummary(entry.data)) return undefined
    const label = turnLabel(entry.data)
    const color = entry.data.outcome === "completed" ? "borderMuted" : entry.data.outcome === "aborted" ? "warning" : "error"
    return {
      render(width: number): string[] {
        const inner = Math.max(0, width - CHROME_MARGIN * 2)
        const rule = ruleLine(inner, label)
        const colored = rule.replace(label, theme.fg("dim", label))
        return ["", `${" ".repeat(CHROME_MARGIN)}${theme.fg(color, colored)}`]
      },
      invalidate() {},
    }
  })

  pi.on("session_start", (_event, next) => {
    if (next.mode !== "tui") return
    ctx = next
  })

  pi.on("agent_start", () => {
    startedAt = Date.now()
    tools = 0
  })

  pi.on("tool_execution_end", () => {
    tools += 1
  })

  pi.on("agent_end", (event) => {
    if (!ctx || ctx.mode !== "tui" || !startedAt) return
    const ev = event as { messages?: Array<{ role?: string; stopReason?: string }> }
    const summary: TurnSummary = {
      endedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      tools,
      outcome: runOutcome(ev.messages),
    }
    startedAt = 0
    try {
      pi.appendEntry(TURN_ENTRY_TYPE, summary)
    } catch {
      // A session that cannot accept entries just goes without the separator.
    }
  })

  pi.on("session_shutdown", () => {
    ctx = undefined
    startedAt = 0
  })

  return () => {
    ctx = undefined
    startedAt = 0
  }
}
