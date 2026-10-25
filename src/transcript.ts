import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { visibleWidth } from "@earendil-works/pi-tui"

export const THINKING_GUTTER = "┊ "

const FENCE = /^\s*(```|~~~)/
const BLOCK_START = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|---\s*$|\*\*\*\s*$|___\s*$)/
/** Below this width wrapping would only make thinking harder to read; prefix source lines instead. */
const MIN_WRAP_WIDTH = 20
/** An inline code span stays whole; everything else splits on spaces. */
const TOKEN = /`[^`]*`|[^\s`]+|`/g

function stripGutter(line: string): string {
	return line.startsWith(THINKING_GUTTER) ? line.slice(THINKING_GUTTER.length) : line
}

/** Split a word wider than `room` into `room`-wide pieces (URLs, long paths). */
function splitWide(word: string, room: number): string[] {
	if (word.startsWith("`") || visibleWidth(word) <= room) return [word]
	const pieces: string[] = []
	let piece = ""
	for (const char of word) {
		if (visibleWidth(piece + char) > room) {
			pieces.push(piece)
			piece = ""
		}
		piece += char
	}
	if (piece) pieces.push(piece)
	return pieces
}

/**
 * Greedy word wrap at `room` cells. Markdown markers (`*`, backticks) count toward the width
 * but are removed when rendered, so lines can only come out shorter than `room`, never wider.
 */
export function wrapLine(line: string, room: number): string[] {
	const words = (line.match(TOKEN) ?? []).flatMap((word) => splitWide(word, room))
	if (words.length === 0) return [""]
	const out: string[] = []
	let current = ""
	for (const word of words) {
		if (!current) current = word
		else if (visibleWidth(current) + 1 + visibleWidth(word) <= room) current += ` ${word}`
		else {
			out.push(current)
			current = word
		}
	}
	out.push(current)
	return out
}

/**
 * Put the thinking gutter on every rendered line of every plain paragraph, so thinking reads as a
 * column beside prose rather than a bullet on its first line. With `width` (the content width the
 * host will render at) paragraph lines are pre-wrapped to `width - 2` so wrapped lines carry the
 * gutter too; pi-tui keeps single newlines as line breaks. Without a usable width only source
 * lines are prefixed.
 *
 * Block syntax (heading, list, quote, table, fence, rule) is left untouched so it still parses,
 * including a list or quote that interrupts a paragraph, and nothing inside fenced code changes.
 */
export function gutterThinking(markdown: string, width?: number): string {
	if (!markdown) return markdown
	const room = width !== undefined && width >= MIN_WRAP_WIDTH ? width - visibleWidth(THINKING_GUTTER) : undefined
	const out: string[] = []
	let inFence = false
	/** "para": inside a plain paragraph; "block": inside block syntax until the next blank line. */
	let mode: "none" | "para" | "block" = "none"
	for (const line of markdown.split("\n")) {
		if (FENCE.test(line)) {
			inFence = !inFence
			out.push(line)
			mode = "none"
			continue
		}
		if (inFence) {
			out.push(line)
			continue
		}
		if (line.trim() === "") {
			out.push(line)
			mode = "none"
			continue
		}
		const body = stripGutter(line)
		if (mode === "block" || BLOCK_START.test(body)) {
			out.push(line)
			mode = "block"
			continue
		}
		mode = "para"
		if (room === undefined) out.push(`${THINKING_GUTTER}${body}`)
		else for (const piece of wrapLine(body, room)) out.push(`${THINKING_GUTTER}${piece}`)
	}
	return out.join("\n")
}

export function installTranscript(pi: ExtensionAPI): void {
	if (typeof pi.registerMarkdownTransformer !== "function") return
	pi.registerMarkdownTransformer((markdown, context) => {
		if (context.messageType !== "assistant-thinking") return markdown
		return gutterThinking(markdown, context.availableWidth)
	})
}
