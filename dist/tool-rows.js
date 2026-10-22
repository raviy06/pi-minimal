import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
/** Width of the verb column so items align across rows. */
export const VERB_WIDTH = 5;
const BASH_STATUS = /^Command (?:exited with code (\d+)|terminated without an exit code)$/;
export function shortName(path) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length <= 1)
        return path || "";
    return parts.slice(-2).join("/");
}
export function toolItem(kind, args) {
    if (kind === "bash") {
        const command = typeof args?.command === "string" ? args.command.split("\n")[0]?.trim() ?? "" : "";
        return command || "bash";
    }
    if (kind === "grep" || kind === "find") {
        return typeof args?.pattern === "string" && args.pattern ? args.pattern : kind;
    }
    const path = (typeof args?.path === "string" && args.path) ||
        (typeof args?.file_path === "string" && args.file_path) ||
        (typeof args?.target_directory === "string" && args.target_directory) ||
        "";
    return path ? shortName(path) : kind;
}
export function resultText(result) {
    if (!result?.content)
        return "";
    return result.content
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
}
export function rowGlyph(status, frame) {
    if (status === "running")
        return frame === 1 ? "◓" : "◐";
    return status === "error" ? "✗" : "✓";
}
export function formatDuration(ms) {
    if (ms === undefined || !Number.isFinite(ms))
        return "";
    if (ms < 1000)
        return `${Math.round(ms / 100) / 10}s`;
    if (ms < 60_000)
        return `${Math.round(ms / 100) / 10}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
}
function plural(n, word, pluralWord = `${word}s`) {
    return `${n} ${n === 1 ? word : pluralWord}`;
}
function countLines(text) {
    if (!text)
        return 0;
    return text.split("\n").filter((line) => line.length > 0).length;
}
/** Strip pi's bash status trailer and truncation note from output text. */
export function bashBody(text) {
    const lines = text.split("\n");
    let exitCode;
    while (lines.length > 0) {
        const last = lines[lines.length - 1].trim();
        const match = BASH_STATUS.exec(last);
        if (match) {
            exitCode = match[1] !== undefined ? Number(match[1]) : undefined;
            lines.pop();
            continue;
        }
        if (last.startsWith("[Showing ") && last.endsWith("]")) {
            lines.pop();
            continue;
        }
        if (last === "") {
            lines.pop();
            continue;
        }
        break;
    }
    return { body: lines.join("\n"), exitCode };
}
export function diffStats(diff) {
    let added = 0;
    let removed = 0;
    for (const line of diff.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---"))
            continue;
        if (line.startsWith("+"))
            added += 1;
        else if (line.startsWith("-"))
            removed += 1;
    }
    return { added, removed };
}
export function formatOutcome(kind, args, result, isError, durationMs) {
    const text = resultText(result);
    const dur = formatDuration(durationMs);
    const join = (...parts) => parts.filter(Boolean).join(" · ");
    if (kind === "bash") {
        const { body, exitCode } = bashBody(text);
        if (isError || (exitCode !== undefined && exitCode !== 0)) {
            const code = exitCode !== undefined ? `exit ${exitCode}` : "failed";
            return { text: join(code, dur), errorLine: firstLine(body) };
        }
        const lines = countLines(body);
        const summary = lines === 0 || body === "(no output)" ? "ok" : plural(lines, "line");
        return { text: join(summary, dur) };
    }
    if (isError)
        return { text: join("failed", dur), errorLine: firstLine(text) };
    if (kind === "edit") {
        const details = result?.details;
        const diff = typeof details?.diff === "string" ? diffStats(details.diff) : undefined;
        return diff ? { text: dur, diff } : { text: join("edited", dur) };
    }
    if (kind === "write") {
        const bytes = typeof args?.content === "string" ? Buffer.byteLength(args.content, "utf8") : undefined;
        return { text: join(bytes === undefined ? "written" : formatBytes(bytes), dur) };
    }
    if (kind === "read") {
        return { text: join(plural(countLines(text), "line"), dur) };
    }
    if (kind === "grep") {
        if (/^No matches found/m.test(text))
            return { text: join("0 matches", dur) };
        return { text: join(plural(countLines(text), "match"), dur) };
    }
    // find / ls
    return { text: join(plural(countLines(text), "entry", "entries"), dur) };
}
export function firstLine(text) {
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && trimmed !== "(no output)")
            return trimmed;
    }
    return undefined;
}
export function formatBytes(n) {
    if (n < 1024)
        return `${n} B`;
    if (n < 1024 * 1024)
        return `${Math.round(n / 102.4) / 10} KB`;
    return `${Math.round(n / (1024 * 102.4)) / 10} MB`;
}
/**
 * Lay out one row: `<glyph> <verb> <item> ... <outcome>`. The item is truncated so the outcome
 * stays visible; the outcome is dropped only when the row is too narrow to show both.
 */
export function layoutRow(width, verb, item, outcome) {
    const verbCol = verb.padEnd(VERB_WIDTH);
    // glyph + space + verb column + space
    const prefixWidth = 2 + VERB_WIDTH + 1;
    const outcomeWidth = visibleWidth(outcome);
    const minGap = 2;
    let shownOutcome = outcome;
    let itemRoom = width - prefixWidth - (outcomeWidth ? outcomeWidth + minGap : 0);
    if (itemRoom < 12 && outcomeWidth) {
        shownOutcome = "";
        itemRoom = width - prefixWidth;
    }
    const shownItem = truncateToWidth(item, Math.max(0, itemRoom), "…");
    const used = prefixWidth + visibleWidth(shownItem) + visibleWidth(shownOutcome);
    const gap = shownOutcome ? Math.max(minGap, width - used) : 0;
    return { verb: verbCol, item: shownItem, gap, outcome: shownOutcome };
}
