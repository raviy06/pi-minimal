import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import type { BackgroundProcess, BackgroundSnapshot, BackgroundTracker } from "./background.js"
import { formatElapsed } from "./working-status.js"

export type BackgroundRow = {
  pid: number
  command: string
  status: "running" | "ended"
  /** Running: time since start. Ended: how long it ran. */
  durationMs: number
}

export function backgroundRows(snap: BackgroundSnapshot, now: number): BackgroundRow[] {
  const row = (proc: BackgroundProcess): BackgroundRow => ({
    pid: proc.pid,
    command: proc.command,
    status: proc.endedAt === undefined ? "running" : "ended",
    durationMs: (proc.endedAt ?? now) - proc.startedAt,
  })
  return [...snap.running.map(row), ...snap.ended.map(row)]
}

/** Status-line segment: `⚙ 2 bg`; undefined when nothing is running. */
export function backgroundSegment(snap: BackgroundSnapshot): string | undefined {
  if (snap.running.length === 0) return undefined
  return `⚙ ${snap.running.length} bg`
}

type Theme = { fg(color: string, text: string): string }

/** Lines of the overlay body for a given width; pure so it can be tested without a TUI. */
export function renderBackgroundLines(rows: BackgroundRow[], selected: number, width: number, theme: Theme, shortcut?: string): string[] {
  const title = theme.fg("accent", "Background processes")
  const hint = theme.fg("dim", shortcut ? `↑↓ select · k kill · K kill group · esc close (${shortcut})` : "↑↓ select · k kill · K kill group · esc close")
  if (rows.length === 0) {
    return [title, theme.fg("muted", "Nothing running in the background."), hint].map((line) => truncateToWidth(line, width))
  }
  const statusWidth = 7
  const durations = rows.map((row) => (row.status === "running" ? formatElapsed(row.durationMs) : `ran ${formatElapsed(row.durationMs)}`))
  const durationWidth = Math.max(...durations.map((text) => text.length))
  const commandWidth = Math.max(8, width - 2 - 1 - statusWidth - 2 - durationWidth)
  const lines = rows.map((row, index) => {
    const marker = index === selected ? theme.fg("accent", "› ") : "  "
    const command = truncateToWidth(row.command, commandWidth, "…").padEnd(commandWidth)
    const status = row.status === "running" ? theme.fg("success", "running") : theme.fg("muted", "ended  ")
    const duration = theme.fg("dim", (durations[index] ?? "").padStart(durationWidth))
    const text = `${marker}${index === selected ? theme.fg("text", command) : theme.fg("muted", command)} ${status}  ${duration}`
    return visibleWidth(text) > width ? truncateToWidth(text, width) : text
  })
  return [title, ...lines, hint]
}

/** Shows the overlay until the user closes it. Resolves when closed. */
export async function showBackgroundOverlay(ctx: ExtensionContext, tracker: BackgroundTracker, shortcut?: string): Promise<void> {
  if (ctx.mode !== "tui") {
    const rows = backgroundRows(tracker.get(), Date.now())
    ctx.ui.notify(rows.length === 0 ? "Nothing running in the background." : rows.map((row) => `${row.pid} ${row.status} ${formatElapsed(row.durationMs)} ${row.command}`).join("\n"), "info")
    return
  }
  await ctx.ui.custom<void>(
    (tui, theme, keybindings, done) => {
      let selected = 0
      let cached: { width: number; lines: string[] } | undefined
      const invalidate = () => { cached = undefined }
      const redraw = () => { invalidate(); tui.requestRender() }
      const unsubscribe = tracker.onChange(redraw)
      const ticker = setInterval(redraw, 1000)
      const rows = () => backgroundRows(tracker.get(), Date.now())
      const finish = () => {
        clearInterval(ticker)
        unsubscribe()
        done()
      }
      return {
        render(width: number): string[] {
          if (cached && cached.width === width) return cached.lines
          const current = rows()
          if (selected >= current.length) selected = Math.max(0, current.length - 1)
          cached = { width, lines: renderBackgroundLines(current, selected, width, theme, shortcut) }
          return cached.lines
        },
        handleInput(data: string): void {
          const current = rows()
          if (keybindings.matches(data, "tui.select.cancel")) { finish(); return }
          if (keybindings.matches(data, "tui.select.up")) selected = current.length === 0 ? 0 : (selected - 1 + current.length) % current.length
          else if (keybindings.matches(data, "tui.select.down")) selected = current.length === 0 ? 0 : (selected + 1) % current.length
          else if (data === "k" || data === "K") {
            const row = current[selected]
            if (row?.status === "running") tracker.kill(row.pid, { group: data === "K" })
          } else return
          redraw()
        },
        invalidate,
        dispose() {
          clearInterval(ticker)
          unsubscribe()
        },
      }
    },
    { overlay: true, overlayOptions: { width: "70%", maxHeight: "60%", anchor: "center" } },
  )
}
