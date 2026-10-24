import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { keyHint } from "@earendil-works/pi-coding-agent"
import { truncateToWidth } from "@earendil-works/pi-tui"
import * as chrome from "./chrome.js"
import { formatTrackerLines } from "./tracker.js"
import type { FooterContributions } from "./footer-contributions.js"
import { activityNeedsAnimation, renderFooterActivity } from "./footer-activity.js"
import { createLiveWatch } from "./live-watch.js"
import { renderFooterPlan } from "./footer-plan.js"

/** Tolerates a stale chrome module after /reload, where only CHROME_MARGIN may exist. */
const margin = (): number => (typeof chrome.chromeMargin === "function" ? chrome.chromeMargin() : (chrome.CHROME_MARGIN ?? 1))


export type FooterSources = {
  /** True while an agent run is in progress. */
  busy: () => boolean
  /** Current editor text, when the host exposes it. */
  editorText: () => string
  /** Context usage percentage, when known. */
  contextPct: () => number | undefined
}

/**
 * Key hints are shown only when nothing else needs the line: idle agent, empty editor. Otherwise
 * the footer collapses to zero lines (tracker lines excepted).
 */
export function footerHints(sources: FooterSources, hints: string[]): string[] {
  if (sources.busy()) return []
  if (sources.editorText().trim().length > 0) return []
  const pct = sources.contextPct()
  const out = [...hints]
  if (pct !== undefined && pct >= 70) out.push("/compact")
  return out
}

export function installFooter(ctx: ExtensionContext, sources: FooterSources, contributions?: FooterContributions): () => void {
  let stopMount = () => {}
  let stopped = false
  ctx.ui.setFooter((tui, theme, footerData) => {
    stopMount()
    if (stopped) return { render: () => [], invalidate() {} }
    const live = createLiveWatch(400)
    let disposed = false
    let activityHasSpace = true
    const redraw = () => { if (!disposed) tui.requestRender() }
    const syncAnimation = () => {
      if (disposed) return
      if (activityHasSpace && activityNeedsAnimation(contributions?.read())) live.watch("footer", redraw)
      else live.unwatch("footer")
    }
    const update = () => { syncAnimation(); redraw() }
    const unsub = footerData.onBranchChange(redraw)
    const unsubscribeActivity = contributions?.subscribe(update)
    stopMount = () => {
      if (disposed) return
      disposed = true
      unsub()
      unsubscribeActivity?.()
      live.stop()
    }
    update()
    return {
      dispose: stopMount,
      invalidate() {},
      render(width: number): string[] {
        const inner = Math.max(8, width - margin() * 2)
        const out: string[] = []
        const hints = footerHints(sources, [
          keyHint("tui.input.submit", "send"),
          keyHint("app.thinking.cycle", "thinking"),
          keyHint("app.tools.expand", "expand tools"),
        ].filter(Boolean))
        if (hints.length > 0) {
          const line = theme.fg("dim", hints.join("  ·  "))
          out.push(`${" ".repeat(margin())}${truncateToWidth(line, inner, "")}`)
        }
        const activityWidth = Math.max(0, width - margin() * 2)
        const plan = renderFooterPlan(contributions?.readPlan(), activityWidth, theme)
        const summary = (plan.length ? plan : formatTrackerLines(ctx, theme as { fg: (name: string, s: string) => string }))
          .map(line => `${" ".repeat(margin())}${truncateToWidth(line, plan.length ? activityWidth : inner, "")}`)
        activityHasSpace = activityWidth > 0
        syncAnimation()
        const activity = renderFooterActivity(contributions?.read(), activityWidth, theme, live.frame)
          .map(line => `${" ".repeat(margin())}${line}`)
        // Preserve legacy-only layout; contributions opt into the spaced layout.
        if (!plan.length && !activity.length) return [...out, ...summary]
        const groups = [out, summary, activity].filter(group => group.length > 0)
        return ["", ...groups.flatMap((group, index) => index === 0 ? group : ["", ...group])]
      },
    }
  })
  return () => { stopped = true; stopMount() }
}
