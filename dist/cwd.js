import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import path from "node:path";
import * as chrome from "./chrome.js";
import { formatGitState } from "./git-state.js";
/** Tolerates a stale chrome module after /reload, where only CHROME_MARGIN may exist. */
const margin = () => (typeof chrome.chromeMargin === "function" ? chrome.chromeMargin() : (chrome.CHROME_MARGIN ?? 1));
export function formatCwd(cwd) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (!home)
        return cwd;
    const resolved = path.resolve(cwd);
    const rel = path.relative(path.resolve(home), resolved);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        return rel ? `~/${rel}` : "~";
    }
    return cwd;
}
export function formatTokens(n) {
    if (n < 1000)
        return String(n);
    if (n < 10000)
        return `${(n / 1000).toFixed(1)}K`;
    if (n < 1e6)
        return `${Math.round(n / 1000)}K`;
    if (n < 1e7)
        return `${(n / 1e6).toFixed(1)}M`;
    return `${Math.round(n / 1e6)}M`;
}
export function modelIcon(id) {
    const s = id.toLowerCase();
    if (s.includes("grok"))
        return "✦";
    if (s.includes("claude") ||
        s.includes("fable") ||
        s.includes("sonnet") ||
        s.includes("opus") ||
        s.includes("haiku")) {
        return "✳";
    }
    if (s.includes("gpt") || s.includes("codex"))
        return "◈";
    return "◆";
}
export function shortModel(id) {
    return (id.split("/").pop() || id).replace(/^claude-/, "");
}
function thinkingColor(level) {
    if (level === "high" || level === "xhigh" || level === "max")
        return "warning";
    if (level === "medium")
        return "accent";
    return "dim";
}
/** Context pressure band used for the meter and percentage colour. */
export function contextBand(pct) {
    if (pct >= 90)
        return "error";
    if (pct >= 70)
        return "warning";
    return "accent";
}
export function meter(percent, fill, empty, cells = 8) {
    const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)));
    return fill.repeat(filled) + empty.repeat(cells - filled);
}
/**
 * Fit `left` and `right` into `width`. Right-hand segments are dropped from the end first (they are
 * the least important), then the left is truncated.
 */
export function splitRow(left, rightSegments, width, sep = "  ") {
    const segments = [...rightSegments.filter((s) => visibleWidth(s) > 0)];
    let right = segments.join(sep);
    while (segments.length > 0 && visibleWidth(left) + 2 + visibleWidth(right) > width) {
        segments.pop();
        right = segments.join(sep);
    }
    let L = left;
    if (visibleWidth(L) + (right ? 2 : 0) + visibleWidth(right) > width) {
        L = truncateToWidth(L, Math.max(0, width - (right ? 2 : 0) - visibleWidth(right)), "");
    }
    const gap = right ? Math.max(2, width - visibleWidth(L) - visibleWidth(right)) : 0;
    return L + " ".repeat(gap) + right;
}
function siblingColor(status) {
    if (status === "idle" || status === "done")
        return "success";
    if (status === "working")
        return "accent";
    if (status === "blocked" || status === "error")
        return "error";
    return "muted";
}
export function installCwd(ctx, sources) {
    ctx.ui.setWidget("tw-cwd", (tui, theme) => {
        const unsub = sources.onChange(() => tui.requestRender());
        return {
            dispose: unsub,
            invalidate() { },
            render(width) {
                const inner = Math.max(8, width - margin() * 2);
                const id = ctx.model?.id || "no-model";
                const icon = theme.fg("accent", modelIcon(id));
                const name = theme.fg("text", shortModel(id));
                const thinking = ctx.thinkingLevel || "";
                const think = thinking ? theme.fg(thinkingColor(thinking), thinking) : "";
                const usage = ctx.getContextUsage?.();
                const window = usage?.contextWindow || ctx.model?.contextWindow;
                const used = usage?.tokens;
                let bar = theme.fg("dim", "░░░░░░░░");
                let pctStr = theme.fg("dim", "?%");
                let tokenStr = theme.fg("dim", "?/?");
                if (typeof used === "number" && window) {
                    const pct = Math.max(0, Math.min(100, Math.round((used / window) * 100)));
                    const band = contextBand(pct);
                    bar = meter(pct, theme.fg(band, "▓"), theme.fg("dim", "░"));
                    pctStr = theme.fg(band === "accent" ? "muted" : band, `${pct}%`);
                    tokenStr = theme.fg("dim", `${formatTokens(used)}/${formatTokens(window)}`);
                }
                else if (used === null && window) {
                    tokenStr = theme.fg("dim", `?/${formatTokens(window)}`);
                }
                const midot = theme.fg("dim", " · ");
                const model = [`${icon} ${name}`, think].filter(Boolean).join(midot);
                const context = `${bar} ${pctStr} ${tokenStr}`;
                const left = `${model}   ${context}`;
                const right = [];
                if (ctx.cwd)
                    right.push(theme.fg("muted", formatCwd(ctx.cwd)));
                const git = formatGitState(sources.gitState());
                if (git.branch) {
                    const dirty = git.dirty ? ` ${theme.fg("warning", git.dirty)}` : "";
                    right.push(`${theme.fg("dim", "⎇")} ${theme.fg("muted", git.branch)}${dirty}`);
                }
                const background = sources.background?.();
                if (background)
                    right.push(theme.fg("warning", background));
                const siblings = sources.siblings();
                if (siblings && siblings.length > 0) {
                    right.push(siblings
                        .map((s) => `${theme.fg("text", s.name)} ${theme.fg(siblingColor(s.status), s.status)}`)
                        .join(theme.fg("dim", " · ")));
                }
                const row = splitRow(left, right, inner);
                return [`${" ".repeat(margin())}${row}`];
            },
        };
    }, { placement: "aboveEditor" });
}
