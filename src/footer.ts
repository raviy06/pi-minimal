import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { keyHint } from "@earendil-works/pi-coding-agent"
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import { CHROME_MARGIN } from "./chrome.js"
import type { Sibling } from "./herdr.js"
import { formatTrackerLines } from "./tracker.js"

function statusColor(
  status: string,
): "success" | "warning" | "error" | "accent" | "muted" {
  if (status === "idle" || status === "done") return "success"
  if (status === "working") return "accent"
  if (status === "blocked") return "error"
  return "muted"
}

export function installFooter(
  ctx: ExtensionContext,
  getSiblings: () => Sibling[] | undefined,
): void {
  ctx.ui.setFooter((tui, theme, footerData) => {
    const unsub = footerData.onBranchChange(() => tui.requestRender())
    return {
      dispose: unsub,
      invalidate() {},
      render(width: number): string[] {
        const send = keyHint("tui.input.submit", "send")
        const think = keyHint("app.thinking.cycle", "thinking")
        const left = [send, think].filter(Boolean).join("  ·  ")

        const siblings = getSiblings()
        let right = ""
        if (siblings && siblings.length > 0) {
          right = siblings
            .map((s) => {
              const name = theme.fg("text", s.name)
              const st = theme.fg(statusColor(s.status), s.status)
              return `${name} ${st}`
            })
            .join(theme.fg("dim", "  ·  "))
        }

        const inner = Math.max(8, width - CHROME_MARGIN * 2)
        const pad = Math.max(1, inner - visibleWidth(left) - visibleWidth(right))
        const line = truncateToWidth(left + " ".repeat(pad) + right, inner, "")
        const out = [`${" ".repeat(CHROME_MARGIN)}${line}`]
        for (const extra of formatTrackerLines(ctx, theme as { fg: (name: string, s: string) => string })) {
          out.push(`${" ".repeat(CHROME_MARGIN)}${truncateToWidth(extra, inner, "")}`)
        }
        return out
      },
    }
  })
}
