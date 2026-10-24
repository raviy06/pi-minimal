import { keyHint } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as chrome from "./chrome.js";
import { formatTrackerLines } from "./tracker.js";
import { activityNeedsAnimation, renderFooterActivity } from "./footer-activity.js";
import { createLiveWatch } from "./live-watch.js";
/** Tolerates a stale chrome module after /reload, where only CHROME_MARGIN may exist. */
const margin = () => (typeof chrome.chromeMargin === "function" ? chrome.chromeMargin() : (chrome.CHROME_MARGIN ?? 1));
/**
 * Key hints are shown only when nothing else needs the line: idle agent, empty editor. Otherwise
 * the footer collapses to zero lines (tracker lines excepted).
 */
export function footerHints(sources, hints) {
    if (sources.busy())
        return [];
    if (sources.editorText().trim().length > 0)
        return [];
    const pct = sources.contextPct();
    const out = [...hints];
    if (pct !== undefined && pct >= 70)
        out.push("/compact");
    return out;
}
export function installFooter(ctx, sources, contributions) {
    let stopMount = () => { };
    let stopped = false;
    ctx.ui.setFooter((tui, theme, footerData) => {
        stopMount();
        if (stopped)
            return { render: () => [], invalidate() { } };
        const live = createLiveWatch(400);
        let disposed = false;
        let activityHasSpace = true;
        const redraw = () => { if (!disposed)
            tui.requestRender(); };
        const syncAnimation = () => {
            if (disposed)
                return;
            if (activityHasSpace && activityNeedsAnimation(contributions?.read()))
                live.watch("footer", redraw);
            else
                live.unwatch("footer");
        };
        const update = () => { syncAnimation(); redraw(); };
        const unsub = footerData.onBranchChange(redraw);
        const unsubscribeActivity = contributions?.subscribe(update);
        stopMount = () => {
            if (disposed)
                return;
            disposed = true;
            unsub();
            unsubscribeActivity?.();
            live.stop();
        };
        update();
        return {
            dispose: stopMount,
            invalidate() { },
            render(width) {
                const inner = Math.max(8, width - margin() * 2);
                const out = [];
                const hints = footerHints(sources, [
                    keyHint("tui.input.submit", "send"),
                    keyHint("app.thinking.cycle", "thinking"),
                    keyHint("app.tools.expand", "expand tools"),
                ].filter(Boolean));
                if (hints.length > 0) {
                    const line = theme.fg("dim", hints.join("  ·  "));
                    out.push(`${" ".repeat(margin())}${truncateToWidth(line, inner, "")}`);
                }
                for (const extra of formatTrackerLines(ctx, theme)) {
                    out.push(`${" ".repeat(margin())}${truncateToWidth(extra, inner, "")}`);
                }
                const activityWidth = Math.max(0, width - margin() * 2);
                activityHasSpace = activityWidth > 0;
                syncAnimation();
                for (const line of renderFooterActivity(contributions?.read(), activityWidth, theme, live.frame)) {
                    out.push(`${" ".repeat(margin())}${line}`);
                }
                return out;
            },
        };
    });
    return () => { stopped = true; stopMount(); };
}
