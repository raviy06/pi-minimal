import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
	applyPoll,
	createBackgroundState,
	createBackgroundTracker,
	findOrphanGroups,
	parseEtime,
	parsePs,
	PS_ARGS,
	snapshot,
} from "../src/background.js"
import { backgroundRows, backgroundSegment, renderBackgroundLines } from "../src/background-overlay.js"

// `ps -ax -o pid=,ppid=,pgid=,etime=,command=` as macOS prints it (right-aligned numbers).
const PI = 76737
const SHELL = 81443
const psBefore = `
 ${PI} 78317 ${PI}    04:11 pi
 81000     1 81000 01-02:03:04 /usr/libexec/trustd --agent
`
const psDuring = `${psBefore}
 ${SHELL} ${PI} ${SHELL}    00:00 /bin/bash -c (./watch.sh &); sleep 0.3
`
const psAfter = `${psBefore}
 81446     1 ${SHELL}    00:01 /bin/bash ./watch.sh
 81450     1 ${SHELL}    00:01 node server.js
 81460     1 81460    00:00 /usr/libexec/other-daemon
`

test.describe("ps parsing", () => {
	test("parseEtime handles every format", () => {
		assert.equal(parseEtime("05"), 5)
		assert.equal(parseEtime("04:11"), 251)
		assert.equal(parseEtime("01:02:03"), 3723)
		assert.equal(parseEtime("01-02:03:04"), 86400 + 7384)
		assert.equal(parseEtime("garbage"), 0)
	})

	test("parsePs reads pid, ppid, pgid, etime and the full command", () => {
		const entries = parsePs(psAfter)
		assert.deepEqual(entries.get(81446), { pid: 81446, ppid: 1, pgid: SHELL, elapsedSec: 1, command: "/bin/bash ./watch.sh" })
		assert.equal(entries.get(81000)?.elapsedSec, 86400 + 7384)
		assert.equal(entries.size, 5)
	})
})

test.describe("findOrphanGroups", () => {
	test("finds the dead tool shell's group and ignores unrelated orphans and pre-existing groups", () => {
		const groups = findOrphanGroups(parsePs(psBefore), parsePs(psAfter))
		assert.deepEqual([...groups], [SHELL])
	})

	test("a group whose leader is still alive is a foreground call, not background", () => {
		const groups = findOrphanGroups(parsePs(psBefore), parsePs(`${psDuring}\n 81446     1 ${SHELL}    00:01 node server.js`))
		assert.equal(groups.size, 0)
	})

	test("a group that existed before the call belongs to someone else", () => {
		const before = parsePs(`${psBefore}\n 81446     1 ${SHELL}    00:10 node server.js`)
		assert.equal(findOrphanGroups(before, parsePs(psAfter)).size, 0)
	})
})

test.describe("applyPoll", () => {
	test("tracks members, marks them ended when gone, forgets them after the TTL and drops empty groups", () => {
		const state = createBackgroundState()
		state.groups.add(SHELL)
		let now = 100_000
		assert.equal(applyPoll(state, parsePs(psAfter), now), true)
		let snap = snapshot(state)
		assert.deepEqual(snap.running.map((p) => [p.pid, p.command, p.startedAt]), [
			[81446, "/bin/bash ./watch.sh", now - 1000],
			[81450, "node server.js", now - 1000],
		])
		assert.equal(snap.ended.length, 0)

		// Nothing changed: no notification.
		assert.equal(applyPoll(state, parsePs(psAfter), now + 2000), false)

		// server.js exits.
		now += 4000
		const onlyWatch = psAfter.split("\n").filter((line) => !line.includes("server.js")).join("\n")
		assert.equal(applyPoll(state, parsePs(onlyWatch), now), true)
		snap = snapshot(state)
		assert.deepEqual(snap.running.map((p) => p.pid), [81446])
		assert.deepEqual(snap.ended.map((p) => [p.pid, p.endedAt]), [[81450, now]])

		// Everything exits; the ended entries linger for a minute, then the group is dropped.
		now += 2000
		assert.equal(applyPoll(state, parsePs(psBefore), now), true)
		assert.equal(snapshot(state).running.length, 0)
		assert.equal(snapshot(state).ended.length, 2)
		assert.equal(state.groups.has(SHELL), true)
		now += 61_000
		assert.equal(applyPoll(state, parsePs(psBefore), now), true)
		assert.equal(snapshot(state).ended.length, 0)
		assert.equal(state.groups.size, 0)
	})
})

test.describe("overlay rendering", () => {
	const theme = { fg: (_c: string, t: string) => t }

	test("segment shows the running count only", () => {
		assert.equal(backgroundSegment({ running: [], ended: [] }), undefined)
		const proc = { pid: 1, pgid: 1, command: "x", startedAt: 0 }
		assert.equal(backgroundSegment({ running: [proc, proc], ended: [proc] }), "⚙ 2 bg")
	})

	test("rows carry status and duration; lines fit the width and mark the selection", () => {
		const now = 1_000_000
		const rows = backgroundRows(
			{
				running: [{ pid: 10, pgid: 1, command: "npm run dev", startedAt: now - 252_000 }],
				ended: [{ pid: 11, pgid: 1, command: "tail -f app.log", startedAt: now - 40_000, endedAt: now - 8000 }],
			},
			now,
		)
		assert.deepEqual(rows, [
			{ pid: 10, command: "npm run dev", status: "running", durationMs: 252_000 },
			{ pid: 11, command: "tail -f app.log", status: "ended", durationMs: 32_000 },
		])
		const lines = renderBackgroundLines(rows, 1, 60, theme, "ctrl+b")
		assert.equal(lines.length, 4)
		assert.match(lines[1] ?? "", /^ {2}npm run dev\s+running\s+4m 12s$/)
		assert.match(lines[2] ?? "", /^› tail -f app.log\s+ended\s+ran 32s$/)
		assert.ok(lines.every((line) => line.length <= 60))
		assert.match(lines[3] ?? "", /ctrl\+b/)
	})

	test("empty list says so", () => {
		const lines = renderBackgroundLines([], 0, 40, theme)
		assert.match(lines[1] ?? "", /Nothing running/)
	})
})

test.describe("createBackgroundTracker", () => {
	const tick = () => new Promise((resolve) => setImmediate(resolve))
	const settle = async () => { for (let i = 0; i < 6; i++) await tick() }

	function fakePi(listings: string[]) {
		const execCalls: string[][] = []
		const pi = {
			async exec(command: string, args: string[]) {
				execCalls.push([command, ...args])
				const stdout = listings.length > 1 ? (listings.shift() as string) : (listings[0] ?? "")
				return { stdout, stderr: "", code: 0, killed: false }
			},
		} as unknown as ExtensionAPI
		return { pi, execCalls }
	}

	test("a bash call that leaves processes behind is tracked; other tools are ignored", async () => {
		const { pi, execCalls } = fakePi([psBefore, psAfter, psAfter])
		const killed: Array<[number, string]> = []
		let now = 500_000
		const tracker = createBackgroundTracker({ pi, now: () => now, killProcess: (pid, signal) => { killed.push([pid, signal]) } })
		let changes = 0
		tracker.onChange(() => { changes += 1 })

		tracker.toolStart("c1", "read")
		tracker.toolEnd("c1", "read")
		await settle()
		assert.equal(execCalls.length, 0)

		tracker.toolStart("c2", "bash")
		await settle()
		tracker.toolEnd("c2", "bash")
		await settle()
		assert.deepEqual(execCalls.slice(0, 2), [["ps", ...PS_ARGS], ["ps", ...PS_ARGS]])
		assert.equal(changes, 1)
		assert.deepEqual(tracker.get().running.map((p) => p.pid), [81446, 81450])

		assert.equal(tracker.kill(81450), true)
		assert.equal(tracker.kill(81446, { group: true, signal: "SIGKILL" }), true)
		assert.equal(tracker.kill(99999), false)
		assert.deepEqual(killed, [[81450, "SIGTERM"], [-SHELL, "SIGKILL"]])

		now += 3000
		tracker.dispose()
		assert.deepEqual(tracker.get().running.map((p) => p.pid), [81446, 81450], "get() still answers after dispose")
	})

	test("a clean bash call tracks nothing and starts no poller", async () => {
		const { pi, execCalls } = fakePi([psBefore, psBefore])
		const tracker = createBackgroundTracker({ pi })
		tracker.toolStart("c1", "bash")
		tracker.toolEnd("c1", "bash")
		await settle()
		assert.equal(execCalls.length, 2)
		assert.equal(tracker.get().running.length, 0)
		await new Promise((resolve) => setTimeout(resolve, 30))
		assert.equal(execCalls.length, 2, "no poll scheduled")
		tracker.dispose()
	})
})
