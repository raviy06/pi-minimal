import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { formatTrackerLines, hideGauntletWidgets } from "../src/tracker.js"

const theme = { fg: (_name: string, s: string) => s }

type PhaseStatus = "pending" | "in_progress" | "complete" | "skipped"
type TaskStatus = "pending" | "in_progress" | "complete" | "failed"

type Snapshot = {
	phases?: Record<string, { status: PhaseStatus; substep?: string | null }>
	tasks?: { name: string; status: TaskStatus }[]
}

function pendingPhases(): Record<string, { status: PhaseStatus; substep?: string | null }> {
	return {
		brainstorm: { status: "pending" },
		plan: { status: "pending" },
		implement: { status: "pending" },
		verify: { status: "pending" },
		ship: { status: "pending" },
	}
}

function ctxFrom(snapshot: Snapshot, setWidget?: (...args: unknown[]) => void): ExtensionContext {
	const branch: unknown[] = []
	if (snapshot.phases !== undefined) {
		branch.push({
			type: "message",
			message: {
				role: "toolResult",
				toolName: "phase_tracker",
				details: { phases: snapshot.phases },
			},
		})
	}
	if (snapshot.tasks !== undefined) {
		branch.push({
			type: "message",
			message: {
				role: "toolResult",
				toolName: "plan_tracker",
				details: { tasks: snapshot.tasks },
			},
		})
	}
	return {
		sessionManager: { getBranch: () => branch },
		ui: { setWidget: setWidget ?? (() => {}) },
	} as unknown as ExtensionContext
}

function hasPhaseLine(lines: string[]): boolean {
	return lines.some((line) => line.includes("Phases"))
}

function hasTaskLine(lines: string[]): boolean {
	return lines.some((line) => line.includes("Tasks"))
}

test("phase line appears only when at least one phase is not pending", () => {
	const phases = pendingPhases()
	phases.implement = { status: "in_progress" }
	const lines = formatTrackerLines(ctxFrom({ phases }), theme)
	assert.equal(hasPhaseLine(lines), true)
})

test("all-pending phases emit no phase line", () => {
	const lines = formatTrackerLines(ctxFrom({ phases: pendingPhases() }), theme)
	assert.equal(hasPhaseLine(lines), false)
})

test("absent phases emit no phase line", () => {
	const lines = formatTrackerLines(ctxFrom({}), theme)
	assert.equal(hasPhaseLine(lines), false)
})

test("nonempty tasks emit a task line", () => {
	const lines = formatTrackerLines(
		ctxFrom({
			tasks: [{ name: "Write tracker tests", status: "in_progress" }],
		}),
		theme,
	)
	assert.equal(hasTaskLine(lines), true)
})

test("empty tasks emit none", () => {
	const lines = formatTrackerLines(ctxFrom({ tasks: [] }), theme)
	assert.equal(hasTaskLine(lines), false)
})

test("hideGauntletWidgets clears phase_tracker and plan_tracker", () => {
	const calls: unknown[][] = []
	const ctx = ctxFrom({}, (...args: unknown[]) => {
		calls.push(args)
	})
	hideGauntletWidgets(ctx)
	assert.deepEqual(calls, [
		["phase_tracker", undefined],
		["plan_tracker", undefined],
	])
})
