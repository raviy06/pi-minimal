import assert from "node:assert/strict"
import test from "node:test"
import { stripVTControlCharacters } from "node:util"
import { Markdown, visibleWidth } from "@earendil-works/pi-tui"
import { gutterThinking, wrapLine } from "../src/transcript.js"

test("gutterThinking prefixes every line of a plain paragraph", () => {
	const input = "First thought\ncontinues here.\n\nSecond thought."
	assert.equal(gutterThinking(input), "┊ First thought\n┊ continues here.\n\n┊ Second thought.")
})

test("gutterThinking leaves block syntax and fenced code alone", () => {
	const input = "# Heading\n\n- item one\n- item two\n\n```js\nconst x = 1\n\nconst y = 2\n```\n\n> quoted\n\nplain"
	assert.equal(
		gutterThinking(input),
		"# Heading\n\n- item one\n- item two\n\n```js\nconst x = 1\n\nconst y = 2\n```\n\n> quoted\n\n┊ plain",
	)
})

test("a list or quote interrupting a paragraph keeps its syntax", () => {
	assert.equal(gutterThinking("Plan:\n- one\n- two\n\nDone."), "┊ Plan:\n- one\n- two\n\n┊ Done.")
	assert.equal(gutterThinking("Note\n> quoted\nlazy line"), "┊ Note\n> quoted\nlazy line")
})

test("gutterThinking is idempotent and handles empty input", () => {
	assert.equal(gutterThinking(""), "")
	const once = gutterThinking("a\n\nb")
	assert.equal(gutterThinking(once), once)
	const wrapped = gutterThinking("one two three four five six seven eight nine ten eleven", 24)
	assert.equal(gutterThinking(wrapped, 24), wrapped)
})

test("with a width, paragraphs are pre-wrapped so wrapped lines carry the gutter", () => {
	const out = gutterThinking("alpha beta gamma delta epsilon zeta eta theta iota kappa", 24)
	assert.deepEqual(out.split("\n"), ["┊ alpha beta gamma delta", "┊ epsilon zeta eta theta", "┊ iota kappa"])
	for (const line of out.split("\n")) assert.ok(visibleWidth(line) <= 24, line)
})

test("narrow or unknown widths fall back to prefixing source lines", () => {
	const long = "alpha beta gamma delta epsilon zeta eta theta"
	assert.equal(gutterThinking(long, 10), `┊ ${long}`)
	assert.equal(gutterThinking(long), `┊ ${long}`)
})

test("wrapLine keeps inline code whole and splits over-wide words", () => {
	assert.deepEqual(wrapLine("use `ctx.ui.confirm here` now", 12), ["use", "`ctx.ui.confirm here`", "now"])
	assert.deepEqual(wrapLine("see https://example.com/a/very/long/path", 12), ["see", "https://exam", "ple.com/a/ve", "ry/long/path"])
	assert.deepEqual(wrapLine("", 12), [""])
})

test("rendered through pi-tui Markdown, every line has the gutter and fits the width", () => {
	const theme = new Proxy({}, { get: () => (s: string) => s }) as never
	const thinking =
		"There's an existing **/subagents** admin TUI with field editing, including `override removal`. " +
		"I should check what it covers so the roster feature doesn't duplicate it — maybe I can hook into it instead, " +
		"like adding model/fallback editing there.\n\nThen the `/roster` command."
	for (const width of [40, 80, 120]) {
		const md = new Markdown(thinking, 0, 0, theme, { color: (s: string) => s, italic: true }, {
			transform: (text: string, available: number) => gutterThinking(text, available),
		} as never)
		const lines = md.render(width).map((line) => stripVTControlCharacters(line).trimEnd())
		const content = lines.filter((line) => line.length > 0)
		assert.ok(content.length >= 3, `width ${width}: ${JSON.stringify(lines)}`)
		for (const line of content) {
			assert.ok(line.startsWith("┊ "), `width ${width}: ${JSON.stringify(line)}`)
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`)
		}
	}
})
