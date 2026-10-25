import { Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { rowIsRunning } from "./activity.js";
import * as chrome from "./chrome.js";
import { callSummary, codemodeOutcome, nestedCalls, nestedItem, scriptOutput } from "./codemode-rows.js";
import { createLiveWatch } from "./live-watch.js";
import { bashBody, formatDuration, formatOutcome, layoutRow, resultText, rowGlyph, toolItem, } from "./tool-rows.js";
/** Tolerates a stale chrome module after /reload, where only CHROME_MARGIN may exist. */
const margin = () => (typeof chrome.chromeMargin === "function" ? chrome.chromeMargin() : (chrome.CHROME_MARGIN ?? 1));
const live = createLiveWatch(400);
/** Left indent of every tool row: chrome margin plus one cell so rows sit inside message text. */
const rowIndent = () => margin() + 1;
/** Max lines of output shown when a row is expanded. */
const EXPANDED_MAX_LINES = 400;
export function stopLiveWatch() {
    live.stop();
}
function liveId(context, item) {
    return context.toolCallId || item;
}
function rowStatus(context) {
    if (context.isError)
        return "error";
    if (context.state.outcome?.errorLine)
        return "error";
    return rowIsRunning(context) ? "running" : "ok";
}
function statusColor(status) {
    if (status === "error")
        return "error";
    if (status === "running")
        return "warning";
    return "success";
}
function expandedLines(kind, result) {
    let text = resultText(result);
    if (kind === "bash")
        text = bashBody(text).body;
    if (!text)
        return [];
    const lines = text.split("\n");
    if (lines.length > EXPANDED_MAX_LINES) {
        const hidden = lines.length - EXPANDED_MAX_LINES;
        return [...lines.slice(0, EXPANDED_MAX_LINES), `… ${hidden} more lines`];
    }
    return lines;
}
function outputBlock(kind, result, theme) {
    const lines = expandedLines(kind, result);
    if (lines.length === 0)
        return new Container();
    const indent = " ".repeat(rowIndent() + 2);
    const rule = theme.fg("borderMuted", "│");
    return {
        render(width) {
            const inner = Math.max(0, width - indent.length - 2);
            return lines.map((line) => `${indent}${rule} ${theme.fg("dim", truncateToWidth(line, inner))}`);
        },
        invalidate() { },
    };
}
function errorLineBlock(line, theme) {
    if (!line)
        return undefined;
    const indent = " ".repeat(rowIndent() + 2);
    const rule = theme.fg("error", "│");
    return {
        render(width) {
            const inner = Math.max(0, width - indent.length - 2);
            return [`${indent}${rule} ${theme.fg("error", truncateToWidth(line, inner))}`];
        },
        invalidate() { },
    };
}
function activityRow(kind, args, theme, context) {
    const item = toolItem(kind, args);
    const id = liveId(context, item);
    const running = rowIsRunning(context);
    context.state.running = running;
    if (running) {
        context.state.startedAt ??= Date.now();
        live.watch(id, context.invalidate);
    }
    else {
        live.unwatch(id);
    }
    return {
        render(width) {
            const status = rowStatus(context);
            const blink = status === "running" && live.has(id);
            const glyph = rowGlyph(status, blink ? live.frame : 0);
            const outcome = context.state.outcome;
            const diff = status !== "running" ? outcome?.diff : undefined;
            let right = "";
            if (status === "running") {
                const started = context.state.startedAt;
                right = started ? formatDuration(Date.now() - started) : "";
            }
            else if (outcome) {
                right = outcome.text;
                if (diff) {
                    const stats = `+${diff.added} −${diff.removed}`;
                    right = right ? `${stats} · ${right}` : stats;
                }
            }
            const inner = Math.max(8, width - rowIndent());
            const row = layoutRow(inner, kind, item, right);
            let coloredRight;
            if (status === "running")
                coloredRight = theme.fg("warning", row.outcome);
            else if (status === "error")
                coloredRight = theme.fg("error", row.outcome);
            else if (diff && row.outcome) {
                const rest = row.outcome.slice(`+${diff.added} −${diff.removed}`.length);
                coloredRight =
                    theme.fg("success", `+${diff.added}`) + " " + theme.fg("error", `−${diff.removed}`) + theme.fg("dim", rest);
            }
            else
                coloredRight = theme.fg("dim", row.outcome);
            const line = " ".repeat(rowIndent()) +
                theme.fg(statusColor(status), glyph) +
                " " +
                theme.fg("dim", row.verb) +
                " " +
                theme.fg(status === "error" ? "text" : "muted", row.item) +
                " ".repeat(row.gap) +
                coloredRight;
            return [line];
        },
        invalidate() { },
    };
}
const TOOL_KINDS = new Set(["bash", "read", "edit", "write", "grep", "find", "ls"]);
export function isToolKind(name) {
    return TOOL_KINDS.has(name);
}
export function compactRenderers(kind) {
    return {
        renderShell: "self",
        renderCall(args, theme, context) {
            return activityRow(kind, args, theme, context);
        },
        renderResult(result, options, theme, context) {
            const renderContext = context;
            const typedResult = result;
            if (!renderContext.isPartial) {
                renderContext.state.done = true;
                renderContext.state.running = false;
                renderContext.state.outcome = formatOutcome(kind, renderContext.args, typedResult, Boolean(renderContext.isError), renderContext.durationMs);
                live.unwatch(liveId(renderContext, toolItem(kind, renderContext.args)));
            }
            const container = new Container();
            const errorLine = errorLineBlock(renderContext.state.outcome?.errorLine, theme);
            if (errorLine && !options.expanded)
                container.addChild(errorLine);
            if (options.expanded)
                container.addChild(outputBlock(kind, typedResult, theme));
            return container;
        },
    };
}
/** Max nested calls shown under a collapsed codemode row; the rest are counted. */
const NESTED_PREVIEW = 8;
/** Width of the nested tool-name column. */
const NESTED_NAME_MAX = 14;
function nestedGlyph(call, frame) {
    if (call.status === "running")
        return { glyph: rowGlyph("running", frame), color: "warning" };
    if (call.status === "error")
        return { glyph: "\u2717", color: "error" };
    if (call.status === "cancelled")
        return { glyph: "\u2298", color: "dim" };
    return { glyph: "\u2713", color: "success" };
}
/** Lines of a `\u2502`-ruled block, dim and truncated, for script source or output on expand. */
function ruledLines(text, width, theme, indent, label) {
    const inner = Math.max(0, width - indent.length - 2);
    const rule = theme.fg("borderMuted", "\u2502");
    let lines = text.split("\n");
    if (lines.length > EXPANDED_MAX_LINES)
        lines = [...lines.slice(0, EXPANDED_MAX_LINES), `\u2026 ${lines.length - EXPANDED_MAX_LINES} more lines`];
    const out = label ? [`${indent}${rule} ${theme.fg("dim", truncateToWidth(label, inner))}`] : [];
    return out.concat(lines.map((line) => `${indent}${rule} ${theme.fg("dim", truncateToWidth(line, inner))}`));
}
/**
 * codemode as a tool row: `\u2713 code  3 calls \u00b7 plan_tracker \u00d72, bash \u2026 54 lines \u00b7 1.2s`, then one
 * child row per nested call. The script and its output appear only when expanded, undecorated,
 * so syntax colours never compete with status colours in the transcript.
 */
export function codemodeRenderers() {
    return {
        renderShell: "self",
        renderCall(args, theme, rawContext) {
            const context = rawContext;
            const code = typeof args?.code === "string" ? (args.code) : "";
            context.state.code = code;
            const id = context.toolCallId || "codemode";
            const running = rowIsRunning(context);
            context.state.running = running;
            if (running) {
                context.state.startedAt ??= Date.now();
                live.watch(id, context.invalidate);
            }
            else
                live.unwatch(id);
            return {
                render(width) {
                    const state = context.state;
                    const status = state.outcome?.errorLine !== undefined || context.isError ? "error" : rowIsRunning(context) ? "running" : "ok";
                    const frame = status === "running" && live.has(id) ? live.frame : 0;
                    const calls = state.calls ?? [];
                    const right = status === "running" ? (state.startedAt ? formatDuration(Date.now() - state.startedAt) : "") : (state.outcome?.text ?? "");
                    const inner = Math.max(8, width - rowIndent());
                    const row = layoutRow(inner, "code", callSummary(calls), right);
                    const rightColor = status === "running" ? "warning" : status === "error" ? "error" : "dim";
                    const lines = [
                        " ".repeat(rowIndent()) +
                            theme.fg(statusColor(status), rowGlyph(status, frame)) +
                            " " +
                            theme.fg("dim", row.verb) +
                            " " +
                            theme.fg(status === "error" ? "text" : "muted", row.item) +
                            " ".repeat(row.gap) +
                            theme.fg(rightColor, row.outcome),
                    ];
                    const expanded = Boolean(context.expanded);
                    const shown = expanded ? calls : calls.slice(-NESTED_PREVIEW);
                    const childIndent = " ".repeat(rowIndent() + 4);
                    if (shown.length < calls.length) {
                        lines.push(`${childIndent}${theme.fg("dim", `\u2026 ${calls.length - shown.length} earlier calls`)}`);
                    }
                    const nameWidth = Math.min(NESTED_NAME_MAX, Math.max(0, ...shown.map((call) => (call.name ?? "tool").length)));
                    for (const call of shown) {
                        const { glyph, color } = nestedGlyph(call, frame);
                        const name = truncateToWidth(call.name ?? "tool", nameWidth, "\u2026").padEnd(nameWidth);
                        const dur = call.status === "error" ? `failed \u00b7 ${formatDuration(call.durationMs)}` : formatDuration(call.durationMs);
                        const room = Math.max(8, width - childIndent.length);
                        // Reuse the row grid with the name as the "verb" column, then fix the glyph slot.
                        const prefixWidth = 2 + nameWidth + 1;
                        const itemRoom = Math.max(0, room - prefixWidth - (dur ? visibleWidth(dur) + 2 : 0));
                        const item = truncateToWidth(nestedItem(call), itemRoom, "\u2026");
                        const gap = dur ? Math.max(2, room - prefixWidth - visibleWidth(item) - visibleWidth(dur)) : 0;
                        lines.push(childIndent +
                            theme.fg(color, glyph) +
                            " " +
                            theme.fg("dim", name) +
                            " " +
                            theme.fg(call.status === "error" ? "text" : "muted", item) +
                            " ".repeat(gap) +
                            theme.fg(call.status === "error" ? "error" : "dim", dur));
                    }
                    return lines;
                },
                invalidate() { },
            };
        },
        renderResult(result, options, theme, rawContext) {
            const context = rawContext;
            const typed = result;
            context.state.calls = nestedCalls(typed);
            if (!context.isPartial) {
                context.state.done = true;
                context.state.running = false;
                const outcome = codemodeOutcome(typed, Boolean(context.isError), context.durationMs);
                context.state.outcome = { text: outcome.text, errorLine: outcome.failed ? (outcome.errorLine ?? "") : undefined };
                context.state.output = scriptOutput(typed);
                live.unwatch(context.toolCallId || "codemode");
            }
            // No invalidate here: the host runs renderCall and renderResult in one updateDisplay() and
            // paints afterwards, so the call row's lazy render() already sees these calls. Calling
            // invalidate() would re-enter updateDisplay() and recurse.
            const container = new Container();
            const expanded = Boolean(options.expanded);
            const errorLine = context.state.outcome?.errorLine;
            if (errorLine && !expanded)
                container.addChild(errorLineBlock(errorLine, theme));
            if (expanded) {
                const indent = " ".repeat(rowIndent() + 4);
                const code = context.state.code ?? "";
                const output = context.state.output ?? "";
                container.addChild({
                    render(width) {
                        const lines = [];
                        if (code)
                            lines.push(...ruledLines(code.trimEnd(), width, theme, indent, `// script \u00b7 ${code.trimEnd().split("\n").length} lines`));
                        if (output)
                            lines.push(...ruledLines(output, width, theme, indent, "// output"));
                        return lines;
                    },
                    invalidate() { },
                });
            }
            return container;
        },
    };
}
/**
 * Attach the compact renderers to the built-in tools without re-registering them. Registered at
 * extension load so a resumed transcript draws its earlier tool calls the same way as new ones.
 */
export function installToolRenderers(pi) {
    if (typeof pi.registerToolRenderer !== "function")
        return;
    pi.registerToolRenderer((toolName, next) => {
        if (toolName === "codemode")
            return codemodeRenderers();
        if (!isToolKind(toolName))
            return next();
        return compactRenderers(toolName);
    });
}
