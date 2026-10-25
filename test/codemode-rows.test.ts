import assert from "node:assert/strict"
import test from "node:test"
import { callSummary, codemodeOutcome, nestedCalls, nestedItem, parseArgs, scriptOutput } from "../src/codemode-rows.js"

const result = (text: string, calls: unknown[] = []) => ({
	content: [
		{ type: "text", text: "Script completed\nWall time 1.2 seconds\nOutput:\n" },
		{ type: "text", text },
	],
	details: { calls },
})

test("parseArgs reads complete JSON and recovers keys from a preview cut at 200 chars", () => {
	assert.deepEqual(parseArgs('{"action":"update","index":6}'), { action: "update", index: 6 })
	const cut = '{"command":"cd ~/repo && sed -n 168,180p docs/a.md && echo \\"===\\" && rg -n x docs/b.md | sed -n 1,30p && ech...'
	assert.equal(parseArgs(cut).command, 'cd ~/repo && sed -n 168,180p docs/a.md && echo "===" && rg -n x docs/b.md | sed -n 1,30p && ech...')
	assert.deepEqual(parseArgs(""), {})
	assert.deepEqual(parseArgs("[1,2]"), {})
	// A cut inside an escape must not throw.
	assert.equal(typeof parseArgs('{"command":"echo \\').command, "string")
})

test("nestedItem reads built-ins like their top-level rows and others as key=value", () => {
	assert.equal(nestedItem({ name: "bash", args: '{"command":"git status\\ngit diff","timeout":10}' }), "git status · +1 line")
	assert.equal(nestedItem({ name: "read", args: '{"path":"/a/b/c/file.ts"}' }), "c/file.ts")
	assert.equal(
		nestedItem({ name: "plan_tracker", args: '{"action":"update","index":6,"status":"complete"}' }),
		"action=update index=6 status=complete",
	)
	assert.equal(nestedItem({ name: "mcp__x__q", args: '{"query":"a","nested":{"b":1},"limit":5,"extra":1,"more":2}' }), "query=a limit=5 extra=1")
	assert.equal(nestedItem({ name: "subagents_enable", args: "{}" }), "")
})

test("callSummary names tools in first-call order with repeat counts", () => {
	assert.equal(callSummary([]), "script")
	assert.equal(callSummary([{ name: "bash" }]), "1 call · bash")
	assert.equal(
		callSummary([{ name: "plan_tracker" }, { name: "plan_tracker" }, { name: "bash" }]),
		"3 calls · plan_tracker ×2, bash",
	)
})

test("scriptOutput drops pi-core's script header; nestedCalls tolerates missing details", () => {
	assert.equal(scriptOutput(result("hello\n")), "hello")
	assert.deepEqual(nestedCalls({ content: [] }), [])
	assert.deepEqual(nestedCalls({ content: [], details: { calls: [null, { name: "bash" }] } }), [{ name: "bash" }])
})

test("codemodeOutcome counts output lines and surfaces the first failure", () => {
	assert.deepEqual(codemodeOutcome(result("a\nb\n\nc"), false, 1200), { text: "3 lines · 1.2s", failed: false })
	assert.deepEqual(codemodeOutcome(result(""), false, 300), { text: "ok · 0.3s", failed: false })
	const failed = codemodeOutcome(
		result("TEST_EXIT=1", [{ name: "bash", status: "ok" }, { name: "bash", status: "error", error: "\nboom: exit 2\nmore" }]),
		false,
		274_000,
	)
	assert.deepEqual(failed, { text: "1 failed · 4m 34s", failed: true, errorLine: "boom: exit 2" })
	const scriptError = codemodeOutcome(result("partial\nScript error: ReferenceError: x is not defined"), true, 50)
	assert.equal(scriptError.failed, true)
	assert.equal(scriptError.errorLine, "ReferenceError: x is not defined")
})
