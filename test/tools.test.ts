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
