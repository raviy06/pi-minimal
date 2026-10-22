import { keyHint } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { chromeMargin } from "./chrome.js";
import { formatTrackerLines } from "./tracker.js";
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
                const inner = Math.max(8, width - chromeMargin() * 2);
                const out = [];
                const hints = footerHints(sources, [
                    keyHint("tui.input.submit", "send"),
                    keyHint("app.thinking.cycle", "thinking"),
                    keyHint("app.tools.expand", "expand tools"),
                ].filter(Boolean));
                if (hints.length > 0) {
                    const line = theme.fg("dim", hints.join("  ·  "));
                    out.push(`${" ".repeat(chromeMargin())}${truncateToWidth(line, inner, "")}`);
                }
                for (const extra of formatTrackerLines(ctx, theme)) {
                    out.push(`${" ".repeat(chromeMargin())}${truncateToWidth(extra, inner, "")}`);
                }
                return out;
            },
        };
    });
}
