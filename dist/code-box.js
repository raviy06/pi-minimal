import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
const PATCHED = Symbol.for("pi-minimal.code-box");
export function frameCodeLines(lines, lang, width, theme) {
    if (lines.length < 2)
        return lines;
    // Trailing spacer ("" after the closing fence) is preserved as-is.
    let end = lines.length;
    while (end > 0 && lines[end - 1] === "")
        end -= 1;
    if (end < 2)
        return lines;
    const trailer = lines.slice(end);
    const body = lines.slice(1, end - 1);
    const indent = theme.codeBlockIndent ?? "  ";
    const inner = Math.max(4, width);
    // "╭─ lang ─────" : corner + lead dash + label + rule == inner
    const label = lang ? ` ${lang} ` : "";
    const topRule = "─".repeat(Math.max(1, inner - 2 - visibleWidth(label)));
    const top = theme.codeBlockBorder(`╭─${label}${topRule}`);
    const bottom = theme.codeBlockBorder(`╰${"─".repeat(Math.max(1, inner - 1))}`);
    const edge = theme.codeBlockBorder("│");
    const framed = body.map((line) => {
        const content = line.startsWith(indent) ? line.slice(indent.length) : line;
        return `${edge} ${content}`;
    });
    if (framed.length === 0)
        framed.push(edge);
    return [top, ...framed, bottom, ...trailer];
}
/** Patch pi-tui's Markdown renderer once per process. Returns false when the renderer is not patchable. */
export function installCodeBox() {
    const proto = Markdown.prototype;
    if (proto[PATCHED])
        return true;
    const original = proto.renderToken;
    if (typeof original !== "function")
        return false;
    const originalRender = original;
    proto.renderToken = function (token, width, next, style) {
        const lines = originalRender.call(this, token, width, next, style);
        if (token?.type !== "code" || !this.theme?.codeBlockBorder)
            return lines;
        try {
            return frameCodeLines(lines, token.lang, width, this.theme);
        }
        catch {
            return lines;
        }
    };
    proto[PATCHED] = true;
    return true;
}
