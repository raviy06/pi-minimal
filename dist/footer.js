import { keyHint } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as chrome from "./chrome.js";
import { formatTrackerLines } from "./tracker.js";
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
export function installFooter(ctx, sources) {
    ctx.ui.setFooter((tui, theme, footerData) => {
        const unsub = footerData.onBranchChange(() => tui.requestRender());
        return {
            dispose: unsub,
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
                return out;
            },
        };
    });
}
