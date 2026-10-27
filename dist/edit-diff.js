import { diffWords } from "diff";
/** The edit tool's `details.diff`, when present and non-empty. */
export function editDiffText(result) {
    const details = result?.details;
    return typeof details?.diff === "string" && details.diff.trim() ? details.diff : undefined;
}
/** pi's edit diff lines: "+123 content", "-123 content", " 123 context"; anything else (e.g. "...") is a separator. */
function parseDiffLine(line) {
    const match = /^([+\- ])(\s*\d*) (.*)$/.exec(line);
    if (!match)
        return undefined;
    return { prefix: match[1], lineNum: match[2], content: match[3].replace(/\t/g, "   ") };
}
/** Word-level diff of a 1:1 replacement; changed tokens are inverted, leading indentation is left alone, as in pi. */
function highlightPair(removed, added, theme) {
    let out = { removed: "", added: "" };
    let firstRemoved = true;
    let firstAdded = true;
    for (const part of diffWords(removed, added)) {
        if (part.removed || part.added) {
            const key = part.removed ? "removed" : "added";
            let value = part.value;
            if (part.removed ? firstRemoved : firstAdded) {
                const ws = /^(\s*)/.exec(value)?.[1] ?? "";
                value = value.slice(ws.length);
                out = { ...out, [key]: out[key] + ws };
                if (part.removed)
                    firstRemoved = false;
                else
                    firstAdded = false;
            }
            if (value)
                out = { ...out, [key]: out[key] + theme.inverse(value) };
        }
        else {
            out = { removed: out.removed + part.value, added: out.added + part.value };
        }
    }
    return out;
}
/** Colours pi's edit diff like pi does: theme diff colours per line, inverse on changed tokens of single-line replacements. */
export function colorDiffLines(lines, theme) {
    const out = [];
    for (let i = 0; i < lines.length;) {
        const parsed = parseDiffLine(lines[i]);
        if (!parsed) {
            out.push(theme.fg("toolDiffContext", lines[i]));
            i++;
            continue;
        }
        if (parsed.prefix === " ") {
            out.push(theme.fg("toolDiffContext", ` ${parsed.lineNum} ${parsed.content}`));
            i++;
            continue;
        }
        const removed = [];
        const added = [];
        for (let p = parseDiffLine(lines[i] ?? ""); p?.prefix === "-"; p = parseDiffLine(lines[++i] ?? ""))
            removed.push(p);
        for (let p = parseDiffLine(lines[i] ?? ""); p?.prefix === "+"; p = parseDiffLine(lines[++i] ?? ""))
            added.push(p);
        if (removed.length === 1 && added.length === 1) {
            const pair = highlightPair(removed[0].content, added[0].content, theme);
            out.push(theme.fg("toolDiffRemoved", `-${removed[0].lineNum} ${pair.removed}`));
            out.push(theme.fg("toolDiffAdded", `+${added[0].lineNum} ${pair.added}`));
            continue;
        }
        for (const line of removed)
            out.push(theme.fg("toolDiffRemoved", `-${line.lineNum} ${line.content}`));
        for (const line of added)
            out.push(theme.fg("toolDiffAdded", `+${line.lineNum} ${line.content}`));
    }
    return out;
}
