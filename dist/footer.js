import { keyHint } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as chrome from "./chrome.js";
import { splitRow } from "./cwd.js";
import { formatTrackerLines } from "./tracker.js";
import { activityNeedsAnimation, renderFooterActivity } from "./footer-activity.js";
import { createLiveWatch } from "./live-watch.js";
import { renderFooterPlan } from "./footer-plan.js";
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
        const unsubscribePrs = sources.onPrsChange?.(redraw);
        const unsubscribeBackground = sources.onBackgroundChange?.(redraw);
        stopMount = () => {
            if (disposed)
                return;
            disposed = true;
            unsub();
            unsubscribeActivity?.();
            unsubscribePrs?.();
            unsubscribeBackground?.();
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
                // Left: hints (idle only) then the background count (always). Right: PR chips whenever
                // there are any. The chips are dropped before the left side when the line is too narrow.
                const background = sources.background?.();
                const left = [hints.length > 0 ? theme.fg("dim", hints.join("  ·  ")) : "", background ? theme.fg("warning", background) : ""]
                    .filter(Boolean)
                    .join(theme.fg("dim", "  ·  "));
                const prs = sources.prs?.(theme);
                if (left || prs) {
                    const line = prs ? splitRow(left, [prs], inner) : truncateToWidth(left, inner, "");
                    out.push(`${" ".repeat(margin())}${line}`);
                }
                const activityWidth = Math.max(0, width - margin() * 2);
                const plan = renderFooterPlan(contributions?.readPlan(), activityWidth, theme);
                const summary = (plan.length ? plan : formatTrackerLines(ctx, theme))
                    .map(line => `${" ".repeat(margin())}${truncateToWidth(line, plan.length ? activityWidth : inner, "")}`);
                activityHasSpace = activityWidth > 0;
                syncAnimation();
                const activity = renderFooterActivity(contributions?.read(), activityWidth, theme, live.frame)
                    .map(line => `${" ".repeat(margin())}${line}`);
                // Preserve legacy-only layout; contributions opt into the spaced layout.
                if (!plan.length && !activity.length)
                    return [...out, ...summary];
                const groups = [out, summary, activity].filter(group => group.length > 0);
                return ["", ...groups.flatMap((group, index) => index === 0 ? group : ["", ...group])];
            },
        };
    });
    return () => { stopped = true; stopMount(); };
}
