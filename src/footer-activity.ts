import { truncateToWidth } from "@earendil-works/pi-tui"
import { cleanActivityText, type ActivitySnapshot, type ActivityState } from "./footer-contributions.js"
import { rowGlyph } from "./tool-rows.js"

type Tone = "warning" | "success" | "error" | "muted"
type Theme = { fg: (color: Tone, text: string) => string }
const MAX_ROWS = 4
const indicators: Record<ActivityState, [string, Tone]> = {
  queued: ["○", "muted"], running: ["◐", "warning"], waiting: ["!", "warning"], paused: ["Ⅱ", "muted"],
  stopping: ["!", "warning"], completed: ["✓", "success"], failed: ["✗", "error"], stopped: ["⊘", "muted"], unknown: ["?", "muted"],
}
export function activityNeedsAnimation(snapshot: ActivitySnapshot | undefined): boolean {
  return snapshot?.motion === "spinner" && snapshot.format === "icons" && snapshot.rows.slice(0, MAX_ROWS).some(row => row.state === "running")
}
export function renderFooterActivity(snapshot: ActivitySnapshot | undefined, width: number, theme: Theme, frame: 0 | 1 = 0): string[] {
  if (!snapshot || width <= 0) return []
  const parents = new Map(snapshot.rows.map(row => [row.key, row.parentKey]))
  const lines = snapshot.rows.slice(0, MAX_ROWS).map(row => {
    const [fallback, tone] = indicators[row.state]
    const glyph = row.state === "running" ? rowGlyph("running", snapshot.motion === "spinner" ? frame : 0)
      : row.state === "completed" ? rowGlyph("ok", 0) : row.state === "failed" ? rowGlyph("error", 0) : fallback
    const marker = snapshot.format === "plain" ? `[${row.state}]` : glyph
    let depth = 0, parent = row.parentKey
    while (parent && depth < 2) { depth++; parent = parents.get(parent) }
    const reason = row.state === "stopping" && snapshot.format === "icons" ? "Stopping: " : ""
    const text = `${"  ".repeat(depth)}${theme.fg(tone, marker)} ${cleanActivityText(row.agent)}  ${reason}${cleanActivityText(row.text)}`.trimEnd()
    return truncateToWidth(text, width)
  })
  const omitted = Math.min(Number.MAX_SAFE_INTEGER, snapshot.omitted + Math.max(0, snapshot.rows.length - MAX_ROWS))
  if (omitted > 0) lines.push(truncateToWidth(theme.fg("muted", `+ ${omitted} more`), width))
  return lines
}
