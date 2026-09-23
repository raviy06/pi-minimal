import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import path from "node:path"
import { CHROME_MARGIN } from "./chrome.js"

function formatCwd(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  if (!home) return cwd
  const resolved = path.resolve(cwd)
  const rel = path.relative(path.resolve(home), resolved)
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel ? `~/${rel}` : "~"
  }
  return cwd
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}K`
  if (n < 1e6) return `${Math.round(n / 1000)}K`
  if (n < 1e7) return `${(n / 1e6).toFixed(1)}M`
  return `${Math.round(n / 1e6)}M`
}

function modelIcon(id: string): string {
  const s = id.toLowerCase()
  if (s.includes("grok")) return "✦"
  if (
    s.includes("claude") ||
    s.includes("fable") ||
    s.includes("sonnet") ||
    s.includes("opus") ||
    s.includes("haiku")
  ) {
    return "✳"
  }
  if (s.includes("gpt") || s.includes("codex")) return "◈"
  return "◆"
}

function shortModel(id: string): string {
  return (id.split("/").pop() || id).replace(/^claude-/, "")
}

function thinkingColor(level: string): "dim" | "accent" | "warning" {
  if (level === "high" || level === "xhigh" || level === "max") return "warning"
  if (level === "medium") return "accent"
  return "dim"
}

function meter(percent: number, fill: string, empty: string): string {
  const n = 8
  const filled = Math.max(0, Math.min(n, Math.round((percent / 100) * n)))
  return fill.repeat(filled) + empty.repeat(n - filled)
}

function splitRow(left: string, right: string, width: number): string {
  let L = left
  let R = right
  while (visibleWidth(L) + 1 + visibleWidth(R) > width && visibleWidth(R) > 0) {
    R = truncateToWidth(R, Math.max(0, visibleWidth(R) - 1), "")
  }
  while (visibleWidth(L) + 1 + visibleWidth(R) > width && visibleWidth(L) > 0) {
    L = truncateToWidth(L, Math.max(0, visibleWidth(L) - 1), "")
  }
  const gap = Math.max(1, width - visibleWidth(L) - visibleWidth(R))
  return L + " ".repeat(gap) + R
}

export function installCwd(ctx: ExtensionContext): void {
  ctx.ui.setWidget(
    "tw-cwd",
    (_tui, theme) => ({
      invalidate() {},
      render(width: number): string[] {
        const inner = Math.max(8, width - CHROME_MARGIN * 2)
        const id = ctx.model?.id || "no-model"
        const icon = theme.fg("accent", modelIcon(id))
        const name = theme.fg("text", shortModel(id))
        const usage = ctx.getContextUsage?.()
        const window = usage?.contextWindow || ctx.model?.contextWindow
        const used = usage?.tokens
        let tokenStr = theme.fg("dim", "?/?")
        let bar = theme.fg("dim", "░░░░░░░░")
        let pctStr = theme.fg("dim", "?%")
        if (typeof used === "number" && window) {
          const pct = Math.max(0, Math.min(100, Math.round((used / window) * 100)))
          tokenStr = theme.fg("dim", `${formatTokens(used)}/${formatTokens(window)}`)
          const hot = pct >= 85
          bar = meter(pct, theme.fg(hot ? "warning" : "accent", "█"), theme.fg("dim", "░"))
          pctStr = theme.fg(hot ? "warning" : "muted", `${pct}%`)
        } else if (used === null && window) {
          tokenStr = theme.fg("dim", `?/${formatTokens(window)}`)
        }
        const thinking = ctx.thinkingLevel || ""
        const think = thinking ? theme.fg(thinkingColor(thinking), thinking) : ""
        const midot = theme.fg("dim", " · ")
        const left = [`${icon} ${name}`, tokenStr, `${bar} ${pctStr}`, think]
          .filter(Boolean)
          .join(midot)
        const right = ctx.cwd ? theme.fg("accent", formatCwd(ctx.cwd)) : ""
        const row = splitRow(left, right, inner)
        return [`${" ".repeat(CHROME_MARGIN)}${row}`]
      },
    }),
    { placement: "aboveEditor" },
  )
}
