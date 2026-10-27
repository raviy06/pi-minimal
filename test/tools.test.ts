import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
	codemodeRenderers,
	compactRenderers,
	genericItem,
	genericOutcome,
	genericRenderers,
	genericVerb,
	installToolRenderers,
	isToolKind,
	setEditDiffMode,
	stopLiveWatch,
} from "../src/tools.js"

test("isToolKind recognises the built-in tools only", () => {
	for (const name of ["bash", "read", "edit", "write", "grep", "find", "ls"]) assert.equal(isToolKind(name), true)
	assert.equal(isToolKind("codemode"), false)
	assert.equal(isToolKind("mcp__foo"), false)
})

test("installToolRenderers registers a resolver at load time that only claims built-in tools", () => {
	let resolver: ((name: string, next: () => unknown) => unknown) | undefined
	const pi = {
		registerToolRenderer(fn: typeof resolver) {
			resolver = fn
		},
	} as unknown as ExtensionAPI
	installToolRenderers(pi)
	assert.ok(resolver, "resolver registered synchronously, before session_start")
	const fallback = { renderShell: "default" }
	const own = { renderCall() {}, renderResult() {} }
	assert.equal(resolver!("subagent", () => own), own, "tools with their own renderer keep it")
	const generic = resolver!("mcp__foo__bar", () => fallback) as { renderShell?: string; renderCall?: unknown }
	assert.equal(generic.renderShell, "self", "renderer-less tools get the compact row")
	assert.equal(typeof generic.renderCall, "function")
	assert.equal((resolver!("mcp__foo__bar", () => undefined) as { renderShell?: string }).renderShell, "self")
	const codemode = resolver!("codemode", () => fallback) as { renderShell?: string }
	assert.equal(codemode.renderShell, "self")
	const mine = resolver!("bash", () => fallback) as { renderShell?: string }
	assert.equal(mine.renderShell, "self")
	assert.equal(typeof (mine as { renderCall?: unknown }).renderCall, "function")
})

test("installToolRenderers is a no-op on hosts without registerToolRenderer", () => {
	assert.doesNotThrow(() => installToolRenderers({} as ExtensionAPI))
})

test("compactRenderers render a one-line row with the outcome once the result lands", () => {
	const renderers = compactRenderers("bash")
	const theme = { fg: (_c: string, s: string) => s } as never
	const state: Record<string, unknown> = {}
	const context = {
		args: { command: "ls" },
		toolCallId: "t1",
		invalidate() {},
		state,
		isPartial: false,
		isError: false,
		durationMs: 1200,
	} as never
	const result = renderers.renderResult!(
		{ content: [{ type: "text", text: "a\nb" }] } as never,
		{ expanded: false, isPartial: false } as never,
		theme,
		context,
	)
	assert.ok(result)
	const row = renderers.renderCall!({ command: "ls" } as never, theme, context)
	const [line] = row.render(60)
	assert.match(line, /✓ bash\s+ls\s+2 lines · 1.2s$/)
})

function codemodeContext(extra: Record<string, unknown> = {}) {
	return {
		args: { code: "await tools.bash({command:'ls'})\ntext(1)" },
		toolCallId: "c1",
		invalidate() {},
		state: {} as Record<string, unknown>,
		isPartial: false,
		isError: false,
		durationMs: 1200,
		...extra,
	}
}

const plainTheme = { fg: (_c: string, s: string) => s } as never
const codemodeResult = (calls: unknown[], output = "a\nb") => ({
	content: [
		{ type: "text", text: "Script completed\nWall time 1.2 seconds\nOutput:\n" },
		{ type: "text", text: output },
	],
	details: { calls },
})

test("codemode renders one parent row plus one child row per nested call, no script", () => {
	const r = codemodeRenderers()
	const context = codemodeContext()
	const calls = [
		{ name: "plan_tracker", args: '{"action":"update","index":6,"status":"complete"}', status: "ok", durationMs: 309 },
		{ name: "bash", args: '{"command":"cd ~/r && sed -n 1,2p a.md"}', status: "ok", durationMs: 636 },
	]
	const body = r.renderResult!(codemodeResult(calls) as never, { expanded: false, isPartial: false } as never, plainTheme, context as never)
	const lines = r.renderCall!(context.args as never, plainTheme, context as never).render(100)
	assert.equal(lines.length, 3)
	assert.match(lines[0], /✓ code\s+2 calls · plan_tracker, bash\s+2 lines · 1.2s$/)
	assert.match(lines[1], /✓ plan_tracker action=update index=6 status=complete\s+0.3s$/)
	assert.match(lines[2], /✓ bash\s+r › sed -n 1,2p a.md\s+0.6s$/)
	assert.ok(lines.every((line) => !line.includes("await")), "script hidden when collapsed")
	assert.deepEqual(body.render(100), [])
	for (const line of lines) assert.ok(line.length <= 100)
})

test("codemode shows the first failure under the row, and script + output when expanded", () => {
	const r = codemodeRenderers()
	const context = codemodeContext({ durationMs: 274_000 })
	const calls = [{ name: "bash", args: '{"command":"npm test"}', status: "error", durationMs: 274_000, error: "fail 2" }]
	const collapsed = r.renderResult!(codemodeResult(calls, "TEST_EXIT=1") as never, { expanded: false, isPartial: false } as never, plainTheme, context as never)
	const [row, child] = r.renderCall!(context.args as never, plainTheme, context as never).render(100)
	assert.match(row, /✗ code\s+1 call · bash\s+1 failed · 4m 34s$/)
	assert.match(child, /✗ bash npm test\s+failed · 4m 34s$/)
	assert.match(collapsed.render(100).join("\n"), /│ fail 2/)

	const open = r.renderResult!(codemodeResult(calls, "TEST_EXIT=1") as never, { expanded: true, isPartial: false } as never, plainTheme, { ...context, expanded: true } as never)
	const text = open.render(100).join("\n")
	assert.match(text, /\/\/ script · 2 lines/)
	assert.match(text, /await tools.bash/)
	assert.match(text, /\/\/ output\n.*TEST_EXIT=1/)
})

test("codemode shows nested calls live while the script is still running", () => {
	const r = codemodeRenderers()
	const context = codemodeContext({ isPartial: true, durationMs: undefined })
	r.renderResult!(codemodeResult([{ name: "bash", args: '{"command":"sleep 5"}', status: "running" }], "") as never, { expanded: false, isPartial: true } as never, plainTheme, context as never)
	const lines = r.renderCall!(context.args as never, plainTheme, context as never).render(80)
	assert.match(lines[0], /^\s+[◐◓] code\s+1 call · bash/)
	assert.match(lines[1], /[◐◓] bash sleep 5/)
	assert.equal((context.state as { done?: boolean }).done, undefined)
	stopLiveWatch()
})

test("generic rows label MCP and agent tools and read arguments as key=value", () => {
	assert.equal(genericVerb("mcp__re_mcp__query_prometheus"), "mcp")
	assert.equal(genericVerb("subagents_enable"), "agent")
	assert.equal(genericVerb("todo"), "tool")
	assert.equal(genericItem("mcp__re_mcp__query_prometheus", { query: "sum(rate(x[5m]))", limit: 5 }), "re_mcp · query_prometheus query=sum(rate(x[5m])) limit=5")
	assert.equal(genericItem("subagents_enable", {}), "subagents_enable")
	assert.equal(genericItem("todo", { action: "add", text: "line one\nline two" }), "todo action=add text=line one")
})

test("generic outcomes show a short first line verbatim, otherwise a line count", () => {
	const text = (s: string) => ({ content: [{ type: "text", text: s }] })
	assert.deepEqual(genericOutcome(text("Updated (9/9 done)"), false, 300), { text: "Updated (9/9 done) · 0.3s" })
	assert.deepEqual(genericOutcome(text("Enabled: subagent. If your tool list includes subagent, call it now."), false, 0), { text: "1 line · 0s" })
	assert.deepEqual(genericOutcome(text("a\nb\n"), false, 1400), { text: "2 lines · 1.4s" })
	assert.deepEqual(genericOutcome(text(""), false, undefined), { text: "ok" })
	assert.deepEqual(genericOutcome(text("\nboom\nmore"), true, 100), { text: "failed · 0.1s", errorLine: "boom" })
})

test("generic renderer draws one row, an error line on failure, and output on expand", () => {
	const r = genericRenderers("mcp__re_mcp__query_prometheus")
	const make = (extra: Record<string, unknown> = {}) => ({ toolCallId: "g1", invalidate() {}, state: {}, isPartial: false, isError: false, durationMs: 1400, ...extra })
	const args = { query: "up" }
	let context = make()
	r.renderResult!({ content: [{ type: "text", text: "a\nb\nc" }] } as never, { expanded: false, isPartial: false } as never, plainTheme, context as never)
	const [line, ...rest] = r.renderCall!(args as never, plainTheme, context as never).render(90)
	assert.match(line, /✓ mcp\s+re_mcp · query_prometheus query=up\s+3 lines · 1.4s$/)
	assert.equal(rest.length, 0)

	context = make({ isError: true })
	const failed = r.renderResult!({ content: [{ type: "text", text: "401 unauthorized" }] } as never, { expanded: false, isPartial: false } as never, plainTheme, context as never)
	assert.match(r.renderCall!(args as never, plainTheme, context as never).render(90)[0], /✗ mcp .*failed · 1.4s$/)
	assert.match(failed.render(90).join(""), /│ 401 unauthorized/)

	context = make({ expanded: true })
	const open = r.renderResult!({ content: [{ type: "text", text: "a\nb" }] } as never, { expanded: true, isPartial: false } as never, plainTheme, context as never)
	assert.deepEqual(open.render(90).map((l) => l.trim()), ["│ a", "│ b"])
})

// pi's edit tool emits its own line-numbered form, not a unified diff: "+123 content", "-123 content", " 123 context", "..." between hunks.
const EDIT_DIFF = " 1 context\n-2 const a = old(x)\n+2 const a = fresh(x)\n 3 context"
const editResult = { content: [{ type: "text", text: "Successfully replaced 1 block(s)" }], details: { diff: EDIT_DIFF } }
function editRows(expanded: boolean, result: unknown = editResult, isError = false): string[] {
	const renderers = compactRenderers("edit")
	const context = { args: { path: "a.ts" }, toolCallId: "e1", invalidate() {}, state: {}, isPartial: false, isError, durationMs: 100 } as never
	const theme = {
		fg: (c: string, s: string) => (c.startsWith("toolDiff") ? `<${c.slice(8).toLowerCase()}>${s}` : s),
		inverse: (s: string) => `[${s}]`,
	} as never
	const block = renderers.renderResult!(result as never, { expanded, isPartial: false } as never, theme, context)
	return block.render(80).map((line) => line.trimEnd())
}

test("editDiff=expanded (default) shows the diff only behind ctrl+o, in the theme's diff colours", (t) => {
	t.after(() => setEditDiffMode("expanded"))
	setEditDiffMode("expanded")
	assert.deepEqual(editRows(false), [])
	const rows = editRows(true)
	assert.equal(rows.length, 4)
	assert.match(rows[0]!, /│ <context> 1 context$/)
	assert.match(rows[1]!, /│ <removed>-2 const a = /)
	assert.match(rows[2]!, /│ <added>\+2 const a = /)
	assert.ok(rows.every((row) => !row.includes("Successfully replaced")), "the diff replaces the result text")
})

test("a one-line replacement highlights only the changed tokens with inverse", (t) => {
	t.after(() => setEditDiffMode("expanded"))
	setEditDiffMode("expanded")
	const [, removed, added] = editRows(true)
	assert.match(removed!, /-2 const a = \[old\]\(x\)$/)
	assert.match(added!, /\+2 const a = \[fresh\]\(x\)$/)
	const multi = editRows(true, { content: [], details: { diff: "-1 a\n-2 b\n+1 c" } })
	assert.ok(multi.every((row) => !row.includes("[")), "blocks that are not 1:1 are not token-highlighted")
})

test("editDiff=always shows the diff inline and editDiff=never only on request falls back to the result text", (t) => {
	t.after(() => setEditDiffMode("expanded"))
	setEditDiffMode("always")
	assert.equal(editRows(false).length, 4)
	assert.equal(editRows(true).length, 4)
	setEditDiffMode("never")
	assert.deepEqual(editRows(false), [])
	assert.match(editRows(true)[0]!, /│ Successfully replaced 1 block\(s\)$/)
})

test("editDiff=always truncates a long inline diff and leaves the full diff to ctrl+o", (t) => {
	t.after(() => setEditDiffMode("expanded"))
	setEditDiffMode("always")
	const long = { content: [{ type: "text", text: "ok" }], details: { diff: Array.from({ length: 60 }, (_, i) => `+${i + 1} line ${i}`).join("\n") } }
	const inline = editRows(false, long)
	assert.equal(inline.length, 41)
	assert.match(inline[40]!, /… 20 more lines \(ctrl\+o\)$/)
	assert.equal(editRows(true, long).length, 60)
})

test("edit failures and results without a diff never render a diff block", (t) => {
	t.after(() => setEditDiffMode("expanded"))
	setEditDiffMode("always")
	assert.deepEqual(editRows(false, { content: [{ type: "text", text: "edited" }] }), [])
	const failed = editRows(false, { content: [{ type: "text", text: "oldText not found" }] }, true)
	assert.ok(failed.every((row) => !row.includes("<removed>")))
})
