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

type Call = { method: string; args: unknown[] }
type SessionMode = "tui" | "rpc" | "json" | "print"

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR"
const originalHerdrEnv = process.env.HERDR_ENV
const originalAgentDir = process.env[AGENT_DIR_ENV]

function restoreEnv() {
	if (originalHerdrEnv === undefined) delete process.env.HERDR_ENV
	else process.env.HERDR_ENV = originalHerdrEnv
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
		sessionManager: { getBranch: () => [] },
		ui,
	} as unknown as ExtensionContext

	const pi = {
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
			if (command === "herdr" && args[0] === "tab") {
				return { stdout: JSON.stringify({ result: { tabs: [] } }), stderr: "", code: 0, killed: false }
			}
			return { stdout: "", stderr: "", code: 1, killed: false }
		},
		registerTool(...args: unknown[]) {
			record(registerCalls, "registerTool", args)
		},
	} as unknown as ExtensionAPI

	const emit = async (event: string, payload: unknown = {}) => {
		for (const handler of handlers.get(event) ?? []) {
			await handler(payload, ctx)
		}
	}

	return { pi, ctx, uiCalls, execCalls, registerCalls, allCalls, emit }
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
	test("TUI session_start installs chrome and hides Gauntlet widgets by default", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
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
		assert.ok(widgetCalls(uiCalls, "phase_tracker").some((call) => call.args[1] === undefined))
		assert.ok(widgetCalls(uiCalls, "plan_tracker").some((call) => call.args[1] === undefined))
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

	test("TUI session_start installs chrome and wraps tools before the first reclaim", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
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
		const firstWrap = allCalls.findIndex((call) => call.method === "registerTool")
		const firstReclaim = allCalls.findIndex((call) => call.method === "setEditorComponent")

		assert.ok(firstHeader >= 0, "header installed")
		assert.ok(firstFooter >= 0, "footer installed")
		assert.ok(firstCwd >= 0, "cwd installed")
		assert.ok(firstWrap >= 0, "tools wrapped")
		assert.ok(firstReclaim >= 0, "reclaim ran")
		assert.ok(firstHeader < firstReclaim, "header before reclaim")
		assert.ok(firstFooter < firstReclaim, "footer before reclaim")
		assert.ok(firstCwd < firstReclaim, "cwd before reclaim")
		assert.ok(firstWrap < firstReclaim, "wrap before reclaim")
	})

	test("does not clear Gauntlet widgets when config disables hiding", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		writeFileSync(join(agentDir, "pi-minimal.json"), JSON.stringify({ hideGauntletWidgets: false }))
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
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
		t.after(restoreEnv)

		const { pi, execCalls, emit } = createFake({ cwd })
		install(pi)
		t.after(() => emit("session_shutdown"))
		await emit("session_start")

		assert.equal(herdrProbes(execCalls).length, 1)
	})

	test("non-TUI modes install no TUI components", async (t) => {
		const { agentDir, cwd } = setupDirs(t)
		process.env[AGENT_DIR_ENV] = agentDir
		delete process.env.HERDR_ENV
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
