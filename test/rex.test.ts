import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
	applyRexEvent,
	createRexSiblings,
	createRexState,
	listRexSiblings,
	parseProgramStatus,
	parseWindowList,
	type RexSpawn,
} from "../src/rex.js"

const SELF = "block:self"
const OTHER = "block:other"
const WIN_SELF = "window:self"
const WIN_OTHER = "window:other"

// Shapes captured from `rex window ls --json`, `rex block call … program_status` and `rex events --json`.
const windowList = JSON.stringify({
	revision: 14,
	session_id: "session:s",
	label: "pi-dev",
	active_window_id: WIN_SELF,
	windows: [
		{
			window_id: WIN_SELF,
			label: "Window 395a96cb",
			focused_block_id: SELF,
			layers: [{ kind: "tiled", blocks: [{ block_id: SELF, label: "shell", creator_name: "com.superlogical.terminal" }] }],
		},
		{
			window_id: WIN_OTHER,
			label: "ry-fix-login",
			focused_block_id: OTHER,
			layers: [
				{
					kind: "tiled",
					blocks: [
						{ block_id: OTHER, label: "shell", creator_name: "com.superlogical.terminal" },
						{ block_id: "block:browser", label: "web", creator_name: "com.superlogical.browser" },
					],
				},
			],
		},
	],
})

function sessionEvent(event: unknown): string {
	return JSON.stringify({ type: "session_event", payload: { session_id: "session:s", event } })
}

function statusChanged(blockId: string, record: Record<string, unknown>, id = ""): string {
	return sessionEvent({
		type: "block_event",
		payload: { block_id: blockId, creator_name: "com.superlogical.terminal", name: "program_status_changed", payload: { id, record, reason: "report" } },
	})
}

function statusRemoved(blockId: string, ids: string[], reason = "child_exited"): string {
	return sessionEvent({
		type: "block_event",
		payload: { block_id: blockId, creator_name: "com.superlogical.terminal", name: "program_status_removed", payload: { ids, reason } },
	})
}

test.describe("rex parsing", () => {
	test("parseWindowList maps terminal blocks to tabs and skips non-terminal blocks", () => {
		const layout = parseWindowList(windowList)
		assert.deepEqual([...layout.tabs], [[WIN_SELF, "Window 395a96cb"], [WIN_OTHER, "ry-fix-login"]])
		assert.deepEqual([...layout.blocks], [[SELF, WIN_SELF], [OTHER, WIN_OTHER]])
	})

	test("parseWindowList rejects output without windows", () => {
		assert.throws(() => parseWindowList("{}"))
	})

	test("parseProgramStatus returns the root record and prefers effective_app", () => {
		const out = JSON.stringify({
			records: [
				{ state: "working", app: "pi", effective_app: "pi", updated_at: "2026-10-28T12:58:11Z", owner: { pid: 1, name: "node" } },
				{ id: "build", state: "blocked", updated_at: "2026-10-28T12:58:11Z" },
			],
		})
		assert.deepEqual(parseProgramStatus(out), { state: "working", app: "pi" })
		assert.equal(parseProgramStatus(JSON.stringify({ records: [] })), undefined)
		assert.equal(parseProgramStatus(JSON.stringify({ records: [{ id: "child", state: "working", updated_at: "x" }] })), undefined)
	})
})

test.describe("rex events", () => {
	test("root status reports create, replace and remove records", () => {
		const state = createRexState()
		state.layout = parseWindowList(windowList)

		assert.equal(applyRexEvent(state, statusChanged(OTHER, { state: "working", app: "pi", effective_app: "pi", updated_at: "x" })), "status")
		assert.deepEqual(listRexSiblings(state, SELF), [{ name: "ry-fix-login", status: "working" }])

		assert.equal(applyRexEvent(state, statusChanged(OTHER, { state: "blocked", kind: "question", app: "pi", msg: "Approve edit?", updated_at: "x" })), "status")
		assert.deepEqual(listRexSiblings(state, SELF), [{ name: "ry-fix-login", status: "blocked" }])

		assert.equal(applyRexEvent(state, statusRemoved(OTHER, [""])), "status")
		assert.equal(listRexSiblings(state, SELF), undefined)
	})

	test("child records, other ids and non-session lines are ignored", () => {
		const state = createRexState()
		assert.equal(applyRexEvent(state, statusChanged(OTHER, { state: "working", updated_at: "x" }, "build/test")), undefined)
		assert.equal(applyRexEvent(state, statusRemoved(OTHER, ["build"])), undefined)
		assert.equal(applyRexEvent(state, sessionEvent({ type: "session_view_changed", payload: { revision: 3 } })), undefined)
		assert.equal(applyRexEvent(state, JSON.stringify({ type: "server_event" })), undefined)
		assert.equal(applyRexEvent(state, "not json"), undefined)
		assert.equal(state.status.size, 0)
	})

	test("block_closed drops the record; label and block changes request a layout refresh", () => {
		const state = createRexState()
		state.layout = parseWindowList(windowList)
		applyRexEvent(state, statusChanged(OTHER, { state: "working", app: "pi", updated_at: "x" }))
		assert.equal(applyRexEvent(state, sessionEvent({ type: "block_closed", payload: { block_id: OTHER } })), "layout")
		assert.equal(state.status.has(OTHER), false)
		assert.equal(state.layout.blocks.has(OTHER), false)
		assert.equal(applyRexEvent(state, sessionEvent({ type: "window_label_changed", payload: { window_id: WIN_OTHER, label: "x" } })), "layout")
		assert.equal(applyRexEvent(state, sessionEvent({ type: "block_created", payload: { block_id: "block:new" } })), "layout")
	})
})

test.describe("listRexSiblings", () => {
	test("excludes self, falls back from auto labels to the app, and needs a self block", () => {
		const state = createRexState()
		state.layout = parseWindowList(windowList)
		state.status.set(SELF, { state: "working", app: "pi" })
		state.status.set(OTHER, { state: "idle", app: "pi" })
		assert.deepEqual(listRexSiblings(state, SELF), [{ name: "ry-fix-login", status: "idle" }])
		// From the other pane's point of view, our auto-labelled tab is named after the program.
		assert.deepEqual(listRexSiblings(state, OTHER), [{ name: "pi", status: "working" }])
		assert.equal(listRexSiblings(state, undefined), undefined)
	})

	test("a pane in the same tab as self is named after its program, not the shared tab", () => {
		const state = createRexState()
		state.layout = parseWindowList(windowList)
		state.layout.blocks.set("block:split", WIN_OTHER)
		state.status.set("block:split", { state: "blocked", app: "terraform" })
		state.status.set(SELF, { state: "working", app: "pi" })
		assert.deepEqual(listRexSiblings(state, OTHER), [
			{ name: "terraform", status: "blocked" },
			{ name: "pi", status: "working" },
		])
	})

	test("a record with neither a real label nor an app is skipped", () => {
		const state = createRexState()
		state.layout = parseWindowList(windowList)
		state.status.set(SELF, { state: "working" })
		assert.equal(listRexSiblings(state, OTHER), undefined)
	})
})

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean; killed: boolean }

function fakeSpawn() {
	const children: FakeChild[] = []
	const calls: string[][] = []
	const spawn: RexSpawn = (command, args) => {
		calls.push([command, ...args])
		const child = new EventEmitter() as FakeChild
		child.stdout = new PassThrough()
		child.stderr = new PassThrough()
		child.killed = false
		child.kill = () => { child.killed = true; return true }
		children.push(child)
		return child as unknown as ReturnType<RexSpawn>
	}
	return { spawn, children, calls }
}

function fakePi(statusByBlock: Record<string, string>) {
	const execCalls: string[][] = []
	const pi = {
		async exec(command: string, args: string[]) {
			execCalls.push([command, ...args])
			if (command === "rex" && args[0] === "window") return { stdout: windowList, stderr: "", code: 0, killed: false }
			if (command === "rex" && args[0] === "block") {
				const block = args[args.indexOf("-b") + 1]
				const stdout = statusByBlock[block] ?? JSON.stringify({ records: [] })
				return { stdout, stderr: "", code: 0, killed: false }
			}
			return { stdout: "", stderr: "", code: 1, killed: false }
		},
	} as unknown as ExtensionAPI
	return { pi, execCalls }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test.describe("createRexSiblings", () => {
	test("seeds from window ls + program_status (skipping self), then follows the event stream", async () => {
		const { spawn, children, calls } = fakeSpawn()
		const { pi, execCalls } = fakePi({
			[OTHER]: JSON.stringify({ records: [{ state: "working", app: "pi", effective_app: "pi", updated_at: "x" }] }),
		})
		const source = createRexSiblings({ pi, spawn, env: { REX_SESSION: "session:s", REX_BLOCK: SELF } })
		let changes = 0
		source.onChange(() => { changes += 1 })

		assert.deepEqual(calls, [["rex", "events", "-s", "session:s", "--json"]])
		for (let i = 0; i < 5; i++) await tick()
		assert.deepEqual(source.get(), [{ name: "ry-fix-login", status: "working" }])
		assert.equal(changes, 1)
		assert.ok(execCalls.some((c) => c[1] === "window"))
		assert.ok(execCalls.some((c) => c[1] === "block" && c.includes(OTHER)))
		assert.equal(execCalls.some((c) => c[1] === "block" && c.includes(SELF)), false, "self is not probed")

		children[0].stdout.write(statusChanged(OTHER, { state: "blocked", kind: "permission", app: "pi", updated_at: "y" }) + "\n")
		for (let i = 0; i < 3; i++) await tick()
		assert.deepEqual(source.get(), [{ name: "ry-fix-login", status: "blocked" }])
		assert.equal(changes, 2)

		// Same state again: no spurious notification.
		children[0].stdout.write(statusChanged(OTHER, { state: "blocked", kind: "permission", app: "pi", updated_at: "z" }) + "\n")
		for (let i = 0; i < 3; i++) await tick()
		assert.equal(changes, 2)

		source.dispose()
		assert.equal(children[0].killed, true)
		assert.equal(source.get(), undefined)
	})

	test("a stream exit clears siblings and a disposed source ignores late events", async () => {
		const { spawn, children } = fakeSpawn()
		const { pi } = fakePi({})
		const source = createRexSiblings({ pi, spawn, env: { REX_SESSION: "session:s", REX_BLOCK: SELF } })
		for (let i = 0; i < 5; i++) await tick()
		children[0].stdout.write(statusChanged(OTHER, { state: "working", app: "pi", updated_at: "x" }) + "\n")
		for (let i = 0; i < 3; i++) await tick()
		assert.deepEqual(source.get(), [{ name: "ry-fix-login", status: "working" }])

		children[0].emit("exit", 1)
		assert.equal(source.get(), undefined)

		source.dispose()
		children[0].stdout.write(statusChanged(OTHER, { state: "working", app: "pi", updated_at: "x" }) + "\n")
		for (let i = 0; i < 3; i++) await tick()
		assert.equal(source.get(), undefined)
	})
})
