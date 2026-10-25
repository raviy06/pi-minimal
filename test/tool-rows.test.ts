import assert from "node:assert/strict"
import test from "node:test"
import { visibleWidth } from "@earendil-works/pi-tui"
import {
	bashBody,
	diffStats,
	formatDuration,
	formatOutcome,
	layoutRow,
	rowGlyph,
	setSessionCwd,
	shortName,
	toolItem,
} from "../src/tool-rows.js"

const text = (s: string) => ({ content: [{ type: "text", text: s }] })

test("toolItem picks the first command line for bash and a two-segment path otherwise", () => {
	assert.equal(toolItem("bash", { command: "git status" }), "git status")
	assert.equal(toolItem("read", { path: "/a/b/c/file.ts" }), "c/file.ts")
	assert.equal(toolItem("grep", { pattern: "foo" }), "foo")
	assert.equal(toolItem("ls", {}), "ls")
	assert.equal(shortName("file.ts"), "file.ts")
})

test("rowGlyph encodes status and blinks only while running", () => {
	assert.equal(rowGlyph("running", 0), "◐")
	assert.equal(rowGlyph("running", 1), "◓")
	assert.equal(rowGlyph("ok", 1), "✓")
	assert.equal(rowGlyph("error", 1), "✗")
})

test("formatDuration rounds to tenths and switches to minutes", () => {
	assert.equal(formatDuration(undefined), "")
	assert.equal(formatDuration(40), "0s")
	assert.equal(formatDuration(1040), "1s")
	assert.equal(formatDuration(1250), "1.3s")
	assert.equal(formatDuration(65_000), "1m 5s")
})

test("bashBody strips the exit status trailer and truncation note", () => {
	const { body, exitCode } = bashBody("hello\nworld\n\nCommand exited with code 2")
	assert.equal(body, "hello\nworld")
	assert.equal(exitCode, 2)
	const ok = bashBody("x\n\n[Showing lines 1-3 of 9. Full output: /tmp/x]")
	assert.equal(ok.body, "x")
	assert.equal(ok.exitCode, undefined)
})

test("diffStats counts hunk lines and ignores file headers", () => {
	assert.deepEqual(diffStats("--- a\n+++ b\n@@\n-x\n+y\n+z\n ctx"), { added: 2, removed: 1 })
})

test("formatOutcome: bash success shows line count and duration", () => {
	const out = formatOutcome("bash", {}, text("a\nb\nc"), false, 1040)
	assert.equal(out.text, "3 lines · 1s")
	assert.equal(out.errorLine, undefined)
})

test("formatOutcome: bash with no output says ok", () => {
	assert.equal(formatOutcome("bash", {}, text("(no output)"), false, 200).text, "ok · 0.2s")
})

test("formatOutcome: bash failure exposes exit code and first output line", () => {
	const out = formatOutcome("bash", {}, text("boom: bad thing\nmore\n\nCommand exited with code 1"), true, 300)
	assert.equal(out.text, "exit 1 · 0.3s")
	assert.equal(out.errorLine, "boom: bad thing")
})

test("formatOutcome: bash failure with no output has no error line", () => {
	const out = formatOutcome("bash", {}, text("(no output)\n\nCommand exited with code 1"), true, 10)
	assert.equal(out.text, "exit 1 · 0s")
	assert.equal(out.errorLine, undefined)
})

test("formatOutcome: edit reports diff stats, write reports bytes", () => {
	const edit = formatOutcome("edit", {}, { content: [], details: { diff: "-a\n+b\n+c" } }, false, undefined)
	assert.deepEqual(edit.diff, { added: 2, removed: 1 })
	assert.equal(edit.text, "")
	const write = formatOutcome("write", { content: "x".repeat(2048) }, text("ok"), false, undefined)
	assert.equal(write.text, "2 KB")
})

test("formatOutcome: read, grep, find summaries", () => {
	assert.equal(formatOutcome("read", {}, text("1\n2"), false, undefined).text, "2 lines")
	assert.equal(formatOutcome("grep", {}, text("No matches found"), false, undefined).text, "0 matches")
	assert.equal(formatOutcome("grep", {}, text("a:1:x"), false, undefined).text, "1 match")
	assert.equal(formatOutcome("find", {}, text("a\nb\nc"), false, undefined).text, "3 entries")
	assert.equal(formatOutcome("ls", {}, text("a"), false, undefined).text, "1 entry")
})

test("formatOutcome: generic error carries the first line", () => {
	const out = formatOutcome("read", {}, text("ENOENT: no such file"), true, undefined)
	assert.equal(out.text, "failed")
	assert.equal(out.errorLine, "ENOENT: no such file")
})

test("layoutRow keeps the outcome visible by truncating the item", () => {
	const row = layoutRow(40, "bash", "a very long command that goes on and on forever", "34 lines · 1.0s")
	assert.equal(row.verb, "bash ")
	assert.equal(row.outcome, "34 lines · 1.0s")
	assert.ok(row.item.includes("…"))
	assert.equal(2 + 5 + 1 + visibleWidth(row.item) + row.gap + row.outcome.length, 40)
})

test("layoutRow drops the outcome when the row is too narrow", () => {
	const row = layoutRow(20, "bash", "short", "34 lines · 1.0s")
	assert.equal(row.outcome, "")
	assert.equal(row.gap, 0)
})

test("bash items drop cd into the session cwd, shorten other cd targets, and count extra lines", () => {
	setSessionCwd("/Users/me/repo", "/Users/me")
	try {
		assert.equal(toolItem("bash", { command: "cd /Users/me/repo && npm test" }), "npm test")
		assert.equal(toolItem("bash", { command: "cd ~/repo/ && npm test" }), "npm test")
		assert.equal(toolItem("bash", { command: "cd ~/Dev/src/github.com/raviy06/pi-subagents && sed -n 1,2p a.ts" }), "pi-subagents › sed -n 1,2p a.ts")
		assert.equal(toolItem("bash", { command: 'cd "/tmp/with space" && ls' }), "with space › ls")
		assert.equal(toolItem("bash", { command: "cd /tmp" }), "cd /tmp", "a bare cd stays as written")
		assert.equal(toolItem("bash", { command: "cd ~/repo && python3 - <<'EOF'\nprint(1)\n\nprint(2)\nEOF" }), "python3 - <<'EOF' · +3 lines")
		assert.equal(toolItem("bash", { command: "git status\ngit diff" }), "git status · +1 line")
	} finally {
		setSessionCwd(undefined)
	}
})
