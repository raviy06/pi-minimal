import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { codemodeRenderers, compactRenderers, installToolRenderers, isToolKind, stopLiveWatch } from "../src/tools.js"

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
	assert.equal(resolver!("mcp__foo__bar", () => fallback), fallback)
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
	assert.match(lines[2], /✓ bash\s+cd ~\/r && sed -n 1,2p a.md\s+0.6s$/)
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
