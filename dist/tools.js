import { createBashToolDefinition, createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition, SettingsManager, } from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth } from "@earendil-works/pi-tui";
import { rowIsRunning } from "./activity.js";
import { createLiveWatch } from "./live-watch.js";
import { bashBody, formatDuration, formatOutcome, layoutRow, resultText, rowGlyph, toolItem, } from "./tool-rows.js";
const live = createLiveWatch(400);
/** Left indent of every tool row, in cells. */
const ROW_INDENT = 2;
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
    const indent = " ".repeat(ROW_INDENT + 2);
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
    const indent = " ".repeat(ROW_INDENT + 2);
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
            const inner = Math.max(8, width - ROW_INDENT);
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
            const line = " ".repeat(ROW_INDENT) +
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
function wrapOne(pi, kind, factory) {
    try {
        const tool = factory();
        pi.registerTool({
            ...tool,
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
        });
    }
    catch {
        // A missing built-in tool leaves the rest of the compact renderers available.
    }
}
export function wrapBuiltinTools(pi, ctx) {
    let commandPrefix;
    let shellPath;
    let autoResizeImages;
    try {
        const settings = SettingsManager.create(ctx.cwd, undefined, {
            projectTrusted: ctx.isProjectTrusted(),
        });
        commandPrefix = settings.getShellCommandPrefix();
        shellPath = settings.getShellPath();
        autoResizeImages = settings.getImageAutoResize();
    }
    catch {
        // Tool wrapping still works when optional shell or image settings are unavailable.
    }
    wrapOne(pi, "bash", () => createBashToolDefinition(ctx.cwd, { commandPrefix, shellPath }));
    wrapOne(pi, "read", () => createReadToolDefinition(ctx.cwd, { autoResizeImages }));
    wrapOne(pi, "edit", () => createEditToolDefinition(ctx.cwd));
    wrapOne(pi, "write", () => createWriteToolDefinition(ctx.cwd));
    wrapOne(pi, "grep", () => createGrepToolDefinition(ctx.cwd));
    wrapOne(pi, "find", () => createFindToolDefinition(ctx.cwd));
    wrapOne(pi, "ls", () => createLsToolDefinition(ctx.cwd));
}
