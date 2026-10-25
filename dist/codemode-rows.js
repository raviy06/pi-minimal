import { firstLine, formatDuration, resultText, toolItem } from "./tool-rows.js";
const KINDS = new Set(["bash", "read", "edit", "write", "grep", "find", "ls"]);
const SCRIPT_HEADER = /^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n?/;
/** Argument keys toolItem() reads, in the order it prefers them. */
const ITEM_KEYS = ["command", "path", "file_path", "target_directory", "pattern"];
export function nestedCalls(result) {
    const calls = result?.details?.calls;
    if (!Array.isArray(calls))
        return [];
    return calls.filter((call) => Boolean(call) && typeof call === "object");
}
/** Script output without pi-core's "Script completed / Wall time / Output:" header. */
export function scriptOutput(result) {
    return resultText(result).replace(SCRIPT_HEADER, "").trim();
}
/**
 * Parse the host's argument preview. Complete JSON parses directly; a preview cut at 200 chars
 * still yields the first string value of each known key, which is all a one-line row needs.
 */
export function parseArgs(args) {
    if (!args)
        return {};
    try {
        const value = JSON.parse(args);
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    catch {
        const out = {};
        const pair = /"([A-Za-z_$][\w$]*)":(?:"((?:[^"\\]|\\.)*)"?|(-?\d+(?:\.\d+)?|true|false|null))/g;
        for (const m of args.matchAll(pair)) {
            if (m[1] in out)
                continue;
            if (m[2] !== undefined)
                out[m[1]] = unescape(m[2]);
            else if (m[3] !== undefined)
                out[m[1]] = JSON.parse(m[3]);
        }
        return out;
    }
}
function unescape(raw) {
    // A cut can land inside an escape; drop a dangling backslash so JSON.parse accepts the rest.
    const safe = raw.replace(/\\(u[0-9a-fA-F]{0,3})?$/, "");
    try {
        return JSON.parse(`"${safe}"`);
    }
    catch {
        return safe;
    }
}
function scalar(value) {
    if (typeof value === "string")
        return value.split("\n")[0]?.trim();
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    return undefined;
}
/**
 * The item column of a nested call. Built-in tools read exactly like their top-level rows
 * (`bash` shows its command, `read` a short path). Other tools show up to three scalar
 * arguments as `key=value`, strings unquoted, instead of raw JSON.
 */
export function nestedItem(call) {
    const name = call.name ?? "tool";
    const args = parseArgs(call.args);
    if (KINDS.has(name)) {
        const picked = {};
        for (const key of ITEM_KEYS)
            if (key in args)
                picked[key] = args[key];
        return toolItem(name, picked);
    }
    const parts = [];
    for (const [key, value] of Object.entries(args)) {
        const shown = scalar(value);
        if (shown === undefined || shown === "")
            continue;
        parts.push(`${key}=${shown}`);
        if (parts.length === 3)
            break;
    }
    return parts.join(" ");
}
/** `3 calls · plan_tracker ×2, bash` — names in first-call order with repeat counts. */
export function callSummary(calls) {
    if (calls.length === 0)
        return "script";
    const counts = new Map();
    for (const call of calls)
        counts.set(call.name ?? "tool", (counts.get(call.name ?? "tool") ?? 0) + 1);
    const names = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
    return `${calls.length} call${calls.length === 1 ? "" : "s"} · ${names}`;
}
/** Right-hand outcome of the parent row, and the line shown under it when something failed. */
export function codemodeOutcome(result, isError, durationMs) {
    const calls = nestedCalls(result);
    const output = scriptOutput(result);
    const failedCalls = calls.filter((call) => call.status === "error");
    const dur = formatDuration(durationMs);
    const join = (...parts) => parts.filter(Boolean).join(" · ");
    if (isError || failedCalls.length > 0) {
        const label = failedCalls.length > 0 ? `${failedCalls.length} failed` : "failed";
        const scriptError = /Script error:\s*(.*)/.exec(output)?.[1];
        const errorLine = firstLine(failedCalls[0]?.error ?? "") ?? scriptError ?? firstLine(output);
        return { text: join(label, dur), failed: true, errorLine };
    }
    const lines = output ? output.split("\n").filter((line) => line.length > 0).length : 0;
    return { text: join(lines === 0 ? "ok" : `${lines} line${lines === 1 ? "" : "s"}`, dur), failed: false };
}
