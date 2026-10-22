import assert from "node:assert/strict"
import test from "node:test"
import { Markdown } from "@earendil-works/pi-tui"
import { frameCodeLines, installCodeBox } from "../src/code-box.js"

const theme = { codeBlockBorder: (s: string) => s }
const ESC = String.fromCharCode(27)
const stripAnsi = (s: string) => s.split(ESC).map((p, i) => (i === 0 ? p : p.replace(/^\[[0-9;]*m/, ""))).join("")

test("frameCodeLines replaces fences with a left-open frame and keeps the trailer", () => {
	const out = frameCodeLines(["```json", '  {"a":1}', "  ", "```", ""], "json", 20, theme)
	assert.equal(out.length, 5)
	assert.ok(out[0].startsWith("╭─ json ─"))
	assert.equal(out[0].length, 20)
	assert.equal(out[1], '│ {"a":1}')
	assert.equal(out[2], "│ ")
	assert.ok(out[3].startsWith("╰─"))
	assert.equal(out[3].length, 20)
	assert.equal(out[4], "")
})

test("frameCodeLines handles empty blocks and missing language", () => {
	const out = frameCodeLines(["```", "```"], undefined, 10, theme)
	assert.deepEqual(out.map((l) => l[0]), ["╭", "│", "╰"])
	assert.ok(!out[0].includes(" "), "no language label")
	assert.deepEqual(frameCodeLines(["x"], undefined, 10, theme), ["x"])
})

test("installCodeBox patches pi-tui's Markdown renderer idempotently", () => {
	assert.equal(installCodeBox(), true)
	assert.equal(installCodeBox(), true)
	const id = (s: string) => s
	const mdTheme = {
		heading: id, link: id, linkUrl: id, code: id, codeBlock: id, codeBlockBorder: id, quote: id, quoteBorder: id,
		hr: id, listBullet: id, bold: id, italic: id, underline: id, strikethrough: id,
	}
	const md = new Markdown("before\n\n```ts\nconst x = 1\n```\n\nafter", 0, 0, mdTheme as never)
	const lines = md.render(40).map(stripAnsi)
	assert.ok(lines.some((l) => l.startsWith("╭─ ts ")), lines.join("\n"))
	assert.ok(lines.some((l) => l.startsWith("│ const x = 1")), lines.join("\n"))
	assert.ok(lines.some((l) => l.startsWith("╰─")), lines.join("\n"))
	assert.ok(!lines.some((l) => l.includes("```")), "no literal fences remain")
})
