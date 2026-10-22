import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { compactRenderers, installToolRenderers, isToolKind } from "../src/tools.js"

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
	assert.equal(resolver!("codemode", () => fallback), fallback)
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
