export const THINKING_GUTTER = "┊ ";
const FENCE = /^\s*(```|~~~)/;
const BLOCK_START = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|---\s*$|\*\*\*\s*$|___\s*$)/;
/**
 * Prefix the first line of every plain paragraph in thinking Markdown with a gutter glyph.
 * Lines that start a Markdown block (heading, list, quote, table, fence, rule) are left alone so
 * they keep parsing, and nothing inside a fenced code block is touched.
 */
export function gutterThinking(markdown) {
    if (!markdown)
        return markdown;
    const lines = markdown.split("\n");
    const out = [];
    let inFence = false;
    let atParagraphStart = true;
    for (const line of lines) {
        if (FENCE.test(line)) {
            inFence = !inFence;
            out.push(line);
            atParagraphStart = !inFence;
            continue;
        }
        if (inFence) {
            out.push(line);
            continue;
        }
        if (line.trim() === "") {
            out.push(line);
            atParagraphStart = true;
            continue;
        }
        if (atParagraphStart && !BLOCK_START.test(line) && !line.startsWith(THINKING_GUTTER)) {
            out.push(`${THINKING_GUTTER}${line}`);
        }
        else {
            out.push(line);
        }
        atParagraphStart = false;
    }
    return out.join("\n");
}
export function installTranscript(pi) {
    if (typeof pi.registerMarkdownTransformer !== "function")
        return;
    pi.registerMarkdownTransformer((markdown, context) => {
        if (context.messageType !== "assistant-thinking")
            return markdown;
        return gutterThinking(markdown);
    });
}
