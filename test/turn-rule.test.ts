import assert from "node:assert/strict"
import test from "node:test"
import { formatClock, isTurnSummary, ruleLine, runOutcome, turnLabel } from "../src/turn-rule.js"

test("turnLabel joins clock, elapsed, tools and non-normal outcomes", () => {
	const endedAt = new Date(2026, 9, 22, 15, 51).getTime()
	assert.equal(turnLabel({ endedAt, elapsedMs: 12_000, tools: 4, outcome: "completed" }), "15:51 · 12s · 4 tools")
	assert.equal(turnLabel({ endedAt, elapsedMs: 3_000, tools: 1, outcome: "aborted" }), "15:51 · 3s · 1 tool · aborted")
	assert.equal(turnLabel({ endedAt, elapsedMs: 3_000, tools: 0, outcome: "error" }), "15:51 · 3s · error")
	assert.equal(formatClock(new Date(2026, 0, 1, 9, 5).getTime()), "09:05")
})

test("ruleLine fills the width and keeps the label when it fits", () => {
	const line = ruleLine(40, "15:51 · 12s")
	assert.equal(line.length, 40)
	assert.ok(line.startsWith("── 15:51 · 12s ─"))
	assert.equal(ruleLine(6, "15:51 · 12s"), "──────")
	assert.equal(ruleLine(0, "x"), "")
})

test("runOutcome reads the last assistant stop reason", () => {
	assert.equal(runOutcome(undefined), "completed")
	assert.equal(runOutcome([{ role: "user" }]), "completed")
	assert.equal(runOutcome([{ role: "assistant", stopReason: "aborted" }, { role: "user" }]), "aborted")
	assert.equal(runOutcome([{ role: "assistant", stopReason: "error" }]), "error")
	assert.equal(runOutcome([{ role: "assistant", stopReason: "stop" }]), "completed")
})

test("isTurnSummary rejects malformed entry data", () => {
	assert.equal(isTurnSummary(null), false)
	assert.equal(isTurnSummary({ endedAt: 1, elapsedMs: 2, tools: 3, outcome: "nope" }), false)
	assert.equal(isTurnSummary({ endedAt: 1, elapsedMs: 2, tools: 3, outcome: "completed" }), true)
})
