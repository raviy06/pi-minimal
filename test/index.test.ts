import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { type TestContext } from "node:test"
import {
	SettingsManager,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import install from "../src/index.js"
import { EventEmitter } from "node:events"
import { FOOTER_EVENTS, type RegisterRequest } from "../src/footer-contribution-events.js"

type Call = { method: string; args: unknown[] }
type SessionMode = "tui" | "rpc" | "json" | "print"

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR"
const originalHerdrEnv = process.env.HERDR_ENV
const originalRexSession = process.env.REX_SESSION
const originalRexBlock = process.env.REX_BLOCK
const originalAgentDir = process.env[AGENT_DIR_ENV]

function restoreEnv() {
	if (originalHerdrEnv === undefined) delete process.env.HERDR_ENV
	else process.env.HERDR_ENV = originalHerdrEnv
	if (originalRexSession === undefined) delete process.env.REX_SESSION
	else process.env.REX_SESSION = originalRexSession
	if (originalRexBlock === undefined) delete process.env.REX_BLOCK
	else process.env.REX_BLOCK = originalRexBlock
	if (originalAgentDir === undefined) delete process.env[AGENT_DIR_ENV]
	else process.env[AGENT_DIR_ENV] = originalAgentDir
}

function setupDirs(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "pi-minimal-session-"))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const agentDir = join(root, "agent")
	const cwd = join(root, "project")
	mkdirSync(agentDir)
	mkdirSync(cwd)
	return { agentDir, cwd }
}

function createFake(options: {
	mode?: SessionMode
	cwd: string
	projectTrusted?: boolean
}) {
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>()
	const uiCalls: Call[] = []
	const execCalls: Call[] = []
	const registerCalls: Call[] = []
	const allCalls: Call[] = []
	const emitter = new EventEmitter()
	const events = {
		emit: (name: string, value: unknown) => { emitter.emit(name, value) },
		on: (name: string, handler: (value: unknown) => void) => { emitter.on(name, handler); return () => { emitter.off(name, handler) } },
	}

	const record = (target: Call[], method: string, args: unknown[]) => {
		const call = { method, args }
		target.push(call)
		allCalls.push(call)
	}

	const ui = {
		setHeader: (...args: unknown[]) => record(uiCalls, "setHeader", args),
		setFooter: (...args: unknown[]) => record(uiCalls, "setFooter", args),
		setWidget: (...args: unknown[]) => record(uiCalls, "setWidget", args),
		setHiddenThinkingLabel: (...args: unknown[]) => record(uiCalls, "setHiddenThinkingLabel", args),
		setWorkingIndicator: (...args: unknown[]) => record(uiCalls, "setWorkingIndicator", args),
		setWorkingMessage: (...args: unknown[]) => record(uiCalls, "setWorkingMessage", args),
		setEditorComponent: (...args: unknown[]) => record(uiCalls, "setEditorComponent", args),
		setHideThinkingBlock: (...args: unknown[]) => record(uiCalls, "setHideThinkingBlock", args),
	}

	const ctx = {
		mode: options.mode ?? "tui",
		cwd: options.cwd,
		isProjectTrusted: () => options.projectTrusted ?? false,
		sessionManager: { getBranch: () => [], getSessionId: () => "S1" },
		ui,
	} as unknown as ExtensionContext

	const pi = {
		events,
		on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
			const list = handlers.get(event) ?? []
			list.push(handler)
			handlers.set(event, list)
			return () => {}
		},
		async exec(command: string, args: string[]) {
			record(execCalls, "exec", [command, args])
			if (command === "herdr" && args[0] === "agent") {
				return { stdout: JSON.stringify({ result: { agents: [] } }), stderr: "", code: 0, killed: false }
			}
			if (command === "gh") {
				return { stdout: "", stderr: "not a github repo", code: 1, killed: false }
			}
			if (command === "herdr" && args[0] === "tab") {
				return { stdout: JSON.stringify({ result: { tabs: [] } }), stderr: "", code: 0, killed: false }
			}
			return { stdout: "", stderr: "", code: 1, killed: false }
		},
		registerTool(...args: unknown[]) {
			record(registerCalls, "registerTool", args)
		},
		registerCommand(...args: unknown[]) {
			record(registerCalls, "registerCommand", args)
		},
		registerShortcut(...args: unknown[]) {
			record(registerCalls, "registerShortcut", args)
		},
		registerToolRenderer(...args: unknown[]) {
			record(registerCalls, "registerToolRenderer", args)
		},
		registerMarkdownTransformer(...args: unknown[]) {
			record(registerCalls, "registerMarkdownTransformer", args)
		},
		registerEntryRenderer(...args: unknown[]) {
			record(registerCalls, "registerEntryRenderer", args)
		},
		appendEntry(...args: unknown[]) {
			record(registerCalls, "appendEntry", args)
		},
	} as unknown as ExtensionAPI

	const emit = async (event: string, payload: unknown = {}) => {
		for (const handler of handlers.get(event) ?? []) {
			await handler(payload, ctx)
		}
	}

	return { pi, ctx, uiCalls, execCalls, registerCalls, allCalls, emit, events }
}

function widgetCalls(uiCalls: Call[], key: string): Call[] {
	return uiCalls.filter((call) => call.method === "setWidget" && call.args[0] === key)
}

function herdrProbes(execCalls: Call[]): Call[] {
	return execCalls.filter(
		(call) => call.method === "exec" && call.args[0] === "herdr" && Array.isArray(call.args[1]) && call.args[1][0] === "agent",
	)
}

test.describe("session chrome", { concurrency: 1 }, () => {
	test("TUI session_start installs chrome and leaves Gauntlet widgets alone by default", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const hideThinking = t.mock.method(SettingsManager.prototype, "setHideThinkingBlock")
		const { pi, uiCalls, execCalls, allCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")

		assert.ok(
			uiCalls.some((call) => call.method === "setHiddenThinkingLabel" && call.args.length === 1 && call.args[0] === "◆ Thought"),
		)
		assert.ok(uiCalls.some((call) => call.method === "setWorkingIndicator" && call.args.length === 0))
		assert.ok(uiCalls.some((call) => call.method === "setHeader" && typeof call.args[0] === "function"))
		assert.ok(uiCalls.some((call) => call.method === "setFooter" && typeof call.args[0] === "function"))
		assert.ok(
			widgetCalls(uiCalls, "tw-cwd").some(
				(call) => typeof call.args[1] === "function" || (call.args[1] !== undefined && call.args[1] !== null),
			),
		)
		assert.equal(widgetCalls(uiCalls, "phase_tracker").length, 0)
		assert.equal(widgetCalls(uiCalls, "plan_tracker").length, 0)
		assert.equal(
			allCalls.some((call) => call.method === "setHideThinkingBlock"),
			false,
		)
		assert.equal(hideThinking.mock.callCount(), 0)
		assert.equal(
			execCalls.filter((call) => call.args[0] === "herdr").length,
			0,
		)
	})

	test("TUI session_start installs chrome before the first reclaim and tool renderers at load", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, allCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")

		const firstHeader = allCalls.findIndex((call) => call.method === "setHeader")
		const firstFooter = allCalls.findIndex((call) => call.method === "setFooter")
		const firstCwd = allCalls.findIndex(
			(call) => call.method === "setWidget" && call.args[0] === "tw-cwd" && typeof call.args[1] === "function",
		)
		const firstWrap = allCalls.findIndex((call) => call.method === "registerToolRenderer")
		const firstSessionStart = allCalls.findIndex((call) => call.method === "setHeader")
		const firstReclaim = allCalls.findIndex((call) => call.method === "setEditorComponent")

		assert.ok(firstHeader >= 0, "header installed")
		assert.ok(firstFooter >= 0, "footer installed")
		assert.ok(firstCwd >= 0, "cwd installed")
		assert.ok(firstWrap >= 0, "tool renderers registered")
		assert.ok(firstWrap < firstSessionStart, "tool renderers registered before session_start chrome (resume-safe)")
		assert.ok(firstReclaim >= 0, "reclaim ran")
		assert.ok(firstHeader < firstReclaim, "header before reclaim")
		assert.ok(firstFooter < firstReclaim, "footer before reclaim")
		assert.ok(firstCwd < firstReclaim, "cwd before reclaim")
		assert.deepEqual(allCalls.filter((call) => call.method === "registerTool").map((call) => (call.args[0] as { name: string }).name), ["list_open_prs"], "only pi-minimal's own tool is registered")
	})

	test("clears Gauntlet widgets on every chrome reassertion when hiding is opted in, and never on a timer", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		writeFileSync(join(agentDir, "pi-minimal.json"), JSON.stringify({ hideGauntletWidgets: true }))
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, uiCalls, emit } = createFake({ cwd, projectTrusted: true })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")
		await new Promise(resolve => setTimeout(resolve, 60))
		const afterSettle = widgetCalls(uiCalls, "phase_tracker").length
		assert.ok(afterSettle >= 1, "hidden at session_start")
		await new Promise(resolve => setTimeout(resolve, 450))
		assert.equal(widgetCalls(uiCalls, "phase_tracker").length, afterSettle, "no steal interval")
		await emit("turn_end")
		assert.equal(widgetCalls(uiCalls, "phase_tracker").length, afterSettle + 1, "hidden again on turn_end")
	})

	test("does not clear Gauntlet widgets when config disables hiding", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		writeFileSync(join(agentDir, "pi-minimal.json"), JSON.stringify({ hideGauntletWidgets: false }))
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, uiCalls, emit } = createFake({ cwd, projectTrusted: true })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")

		assert.equal(widgetCalls(uiCalls, "phase_tracker").length, 0)
		assert.equal(widgetCalls(uiCalls, "plan_tracker").length, 0)
		assert.ok(uiCalls.some((call) => call.method === "setHeader" && typeof call.args[0] === "function"))
		assert.ok(uiCalls.some((call) => call.method === "setFooter" && typeof call.args[0] === "function"))
		assert.ok(widgetCalls(uiCalls, "tw-cwd").length > 0)
	})

	test("does not execute herdr when HERDR_ENV is unset", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, execCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")

		assert.equal(
			execCalls.filter((call) => call.args[0] === "herdr").length,
			0,
		)
		assert.equal(herdrProbes(execCalls).length, 0)
	})

	test("probes herdr once when HERDR_ENV is 1", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		process.env.HERDR_ENV = "1"
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, execCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")

		assert.equal(herdrProbes(execCalls).length, 1)
		assert.equal(execCalls.filter((call) => call.args[0] === "rex").length, 0)
	})

	test("inside Rex (REX_SESSION + REX_BLOCK) it reads the Rex session instead of herdr", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		process.env.REX_SESSION = "session:test"
		process.env.REX_BLOCK = "block:self"
		t.after(restoreEnv)

		const { pi, execCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")
		await new Promise((resolve) => setTimeout(resolve, 20))

		assert.equal(herdrProbes(execCalls).length, 0)
		assert.deepEqual(
			execCalls.filter((call) => call.args[0] === "rex").map((call) => call.args[1]),
			[["window", "ls", "-s", "session:test", "--json"]],
		)
	})

	test("Herdr wins when both Herdr and Rex are present", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		process.env.HERDR_ENV = "1"
		process.env.REX_SESSION = "session:test"
		process.env.REX_BLOCK = "block:self"
		t.after(restoreEnv)

		const { pi, execCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")

		assert.equal(herdrProbes(execCalls).length, 1)
		assert.equal(execCalls.filter((call) => call.args[0] === "rex").length, 0)
	})

	test("registers /bg and the background shortcut once, honouring backgroundShortcut", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		writeFileSync(join(agentDir, "pi-minimal.json"), JSON.stringify({ backgroundShortcut: "ctrl+g" }))
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, registerCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		assert.ok(registerCalls.some((call) => call.method === "registerCommand" && call.args[0] === "bg"))
		assert.equal(registerCalls.filter((call) => call.method === "registerShortcut").length, 0, "shortcut waits for session config")
		await emit("session_start")
		await emit("session_start")
		const shortcuts = registerCalls.filter((call) => call.method === "registerShortcut")
		assert.deepEqual(shortcuts.map((call) => call.args[0]), ["ctrl+g"])
	})

	test("a TUI session asks gh for the repo once and registers /prs", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, execCalls, registerCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		assert.ok(registerCalls.some((call) => call.method === "registerCommand" && call.args[0] === "prs"))
		await emit("session_start")
		await new Promise((resolve) => setTimeout(resolve, 20))
		assert.deepEqual(execCalls.filter((call) => call.args[0] === "gh").map((call) => call.args[1]), [["repo", "view", "--json", "nameWithOwner,url"]])
	})

	test("a bash call running gh pr create records the PR URL as a session entry", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, execCalls, registerCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")
		await emit("tool_execution_start", { toolCallId: "b1", toolName: "bash", args: { command: "gh pr create --fill" } })
		await emit("tool_execution_end", {
			toolCallId: "b1", toolName: "bash", isError: false,
			result: { content: [{ type: "text", text: "Creating pull request…\nhttps://github.com/raviy06/pi-minimal/pull/24\n" }] },
		})
		await new Promise((resolve) => setTimeout(resolve, 20))
		const entries = registerCalls.filter((call) => call.method === "appendEntry")
		assert.deepEqual(entries.map((call) => call.args), [["pi-minimal.pr", { url: "https://github.com/raviy06/pi-minimal/pull/24" }]])
		assert.ok(execCalls.some((call) => call.args[0] === "gh" && (call.args[1] as string[])[1] === "view"), "the PR is fetched by URL")
	})

	test("bash tool calls are inspected with ps; other tools are not", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, execCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")
		await emit("tool_execution_start", { toolCallId: "r1", toolName: "read" })
		await emit("tool_execution_end", { toolCallId: "r1", toolName: "read" })
		await new Promise((resolve) => setTimeout(resolve, 10))
		assert.equal(execCalls.filter((call) => call.args[0] === "ps").length, 0)
		await emit("tool_execution_start", { toolCallId: "b1", toolName: "bash" })
		await emit("tool_execution_end", { toolCallId: "b1", toolName: "bash" })
		await new Promise((resolve) => setTimeout(resolve, 10))
		assert.equal(execCalls.filter((call) => call.args[0] === "ps").length, 2)
	})

	test("non-TUI modes install no TUI components", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
		delete process.env.REX_SESSION
		delete process.env.REX_BLOCK
		t.after(restoreEnv)

		const { pi, uiCalls, execCalls, emit } = createFake({ cwd, mode: "print" })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")
		await emit("agent_start")
		await emit("agent_settled")

		assert.equal(
			uiCalls.filter((call) => ["setHeader", "setFooter", "setWidget"].includes(call.method)).length,
			0,
		)
		assert.equal(
			uiCalls.filter((call) => call.method === "setHiddenThinkingLabel" || call.method === "setWorkingIndicator").length,
			0,
		)
		assert.equal(
			uiCalls.filter((call) => call.method === "setWorkingMessage").length,
			0,
		)
		assert.equal(
			execCalls.filter((call) => call.args[0] === "herdr").length,
			0,
		)
	})
})

test("footer registration survives chrome reinstalls and becomes inert on shutdown", async (t) => {
	const { agentDir, cwd } = setupDirs(t)
	process.env[AGENT_DIR_ENV] = agentDir
	delete process.env.HERDR_ENV
	delete process.env.REX_SESSION
	delete process.env.REX_BLOCK
	t.after(restoreEnv)
	const { pi, emit, events, uiCalls } = createFake({ cwd })
	install(pi)
	t.after(() => emit("session_shutdown"))
	await emit("session_start")
	const req: RegisterRequest = { version: 1, owner: "activity", sessionId: "S1", slot: "activity" }
	events.emit(FOOTER_EVENTS.register, req)
	assert.ok(req.result?.ok)
	const handle = req.result.registration
	const data = { revision: 0, rows: [], omitted: 0, motion: "static", format: "icons" }
	assert.equal(handle.publish(data).ok, true)
	await emit("turn_end")
	await emit("tool_execution_end")
	assert.equal(handle.publish({ ...data, revision: 1 }).ok, true)
	await emit("session_shutdown")
	assert.equal(handle.publish({ ...data, revision: 2 }).ok, false)
	const count = uiCalls.length
	await new Promise(resolve => setTimeout(resolve, 70))
	assert.equal(uiCalls.length, count, "settle callbacks must not reinstall after shutdown")
})

test("agent_end appends a turn summary entry in TUI mode", async (t) => {
	const { agentDir, cwd } = setupDirs(t)
	process.env[AGENT_DIR_ENV] = agentDir
	delete process.env.HERDR_ENV
	delete process.env.REX_SESSION
	delete process.env.REX_BLOCK
	t.after(restoreEnv)
	const { pi, registerCalls, emit } = createFake({ cwd })
	install(pi)
	t.after(() => emit("session_shutdown"))
	await emit("session_start")
	await emit("agent_start")
	await emit("tool_execution_end", { toolCallId: "a" })
	await emit("tool_execution_end", { toolCallId: "b" })
	await emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] })
	const appended = registerCalls.filter((c) => c.method === "appendEntry")
	assert.equal(appended.length, 1)
	assert.equal(appended[0].args[0], "pi-minimal.turn")
	const data = appended[0].args[1] as { tools: number; outcome: string }
	assert.equal(data.tools, 2)
	assert.equal(data.outcome, "completed")
	assert.ok(registerCalls.some((c) => c.method === "registerEntryRenderer" && c.args[0] === "pi-minimal.turn"))
})

test("a second session_start disposes the first session's chrome and the stale one cannot draw", async (t) => {
	const { agentDir, cwd } = setupDirs(t)
	process.env[AGENT_DIR_ENV] = agentDir
	delete process.env.HERDR_ENV
	delete process.env.REX_SESSION
	delete process.env.REX_BLOCK
	t.after(restoreEnv)
	const { pi, emit, events, uiCalls } = createFake({ cwd })
	install(pi)
	t.after(() => emit("session_shutdown"))
	await emit("session_start")
	const first: RegisterRequest = { version: 1, owner: "a", sessionId: "S1", slot: "activity" }
	events.emit(FOOTER_EVENTS.register, first)
	assert.ok(first.result?.ok)
	await emit("session_start")
	assert.equal(first.result.registration.publish({ revision: 1, rows: [], omitted: 0, motion: "static", format: "icons" }).ok, false, "old registration is revoked")
	const second: RegisterRequest = { version: 1, owner: "a", sessionId: "S1", slot: "activity" }
	events.emit(FOOTER_EVENTS.register, second)
	assert.ok(second.result?.ok, "the new session accepts a fresh registration")
	const count = uiCalls.length
	await new Promise(resolve => setTimeout(resolve, 70))
	assert.ok(uiCalls.length >= count, "settle callbacks of the live session still run")
})
