import assert from "node:assert/strict"
import test from "node:test"
import { Markdown } from "@earendil-works/pi-tui"
import { frameCodeLines, installCodeBox } from "../src/code-box.js"

const theme = { codeBlockBorder: (s: string) => s }
const ESC = String.fromCharCode(27)
const stripAnsi = (s: string) => s.split(ESC).map((p, i) => (i === 0 ? p : p.replace(/^\[[0-9;]*m/, ""))).join("")

test("frameCodeLines replaces fences with a closed box and keeps the trailer", () => {
	const out = frameCodeLines(["```json", '  {"a":1}', "  ", "```", ""], "json", 20, theme)
	assert.equal(out.length, 5)
	assert.ok(out[0].startsWith("╭─ json ─") && out[0].endsWith("╮"))
	assert.equal(out[1], '│ {"a":1}          │')
	assert.equal(out[2], "│                  │")
	assert.ok(out[3].startsWith("╰─") && out[3].endsWith("╯"))
	for (const l of out.slice(0, 4)) assert.equal(l.length, 20, l)
	assert.equal(out[4], "")
})

test("frameCodeLines wraps long lines inside the box", () => {
	const out = frameCodeLines(["```", "  " + "x".repeat(30), "```"], undefined, 20, theme)
	assert.equal(out.length, 4, out.join("\n"))
	assert.equal(out[1], `│ ${"x".repeat(16)} │`)
	assert.equal(out[2], `│ ${"x".repeat(14)}   │`)
	for (const l of out) assert.equal(l.length, 20, l)
})

test("frameCodeLines handles empty blocks and missing language", () => {
	const out = frameCodeLines(["```", "```"], undefined, 10, theme)
	assert.deepEqual(out.map((l) => l[0]), ["╭", "│", "╰"])
	assert.deepEqual(out.map((l) => l[l.length - 1]), ["╮", "│", "╯"])
	assert.ok(!out[0].includes(" "), "no language label")
	assert.deepEqual(frameCodeLines(["x"], undefined, 10, theme), ["x"])
})

test("installCodeBox patches pi-tui's Markdown renderer idempotently", () => {
	assert.equal(installCodeBox(), true)
	assert.equal(installCodeBox(), true)
	// A reload re-points the installed wrapper at the current framer.
	const slot = Symbol.for("pi-minimal.code-box.frame")
	const slots = globalThis as unknown as Record<symbol, unknown>
	assert.equal(slots[slot], frameCodeLines)
	const id = (s: string) => s
	const mdTheme = {
		heading: id, link: id, linkUrl: id, code: id, codeBlock: id, codeBlockBorder: id, quote: id, quoteBorder: id,
		hr: id, listBullet: id, bold: id, italic: id, underline: id, strikethrough: id,
	}
	const md = new Markdown("before\n\n```ts\nconst x = 1\n```\n\nafter", 0, 0, mdTheme as never)
	const lines = md.render(40).map(stripAnsi)
	assert.ok(lines.some((l) => l.startsWith("╭─ ts ") && l.endsWith("╮")), lines.join("\n"))
	assert.ok(lines.some((l) => l.startsWith("│ const x = 1") && l.endsWith("│")), lines.join("\n"))
	assert.ok(lines.some((l) => l.startsWith("╰─") && l.endsWith("╯")), lines.join("\n"))
	assert.ok(!lines.some((l) => l.includes("```")), "no literal fences remain")
})
