import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { installWorkingStatus } from "../src/working-status.js"

function fixture() {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>()
	const messages: Array<string | undefined> = []
	const ctx = { mode: "tui", ui: { setWorkingMessage: (text?: string) => { messages.push(text) } } } as unknown as ExtensionContext
	const pi = { on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => void) => { handlers.set(name, handler) } } as unknown as ExtensionAPI
	const stop = installWorkingStatus(pi)
	const emit = (name: string, event: unknown = {}) => handlers.get(name)!(event, ctx)
	return { emit, messages, stop }
}

test("working status walks thinking → tool → thinking → writing and clears when the agent settles", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"] })
	const f = fixture()
	f.emit("session_start")
	f.emit("agent_start")
	assert.match(f.messages.at(-1)!, /^Thinking · /)
	f.emit("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: "ls -la" } })
	assert.match(f.messages.at(-1)!, /^Running ls -la/)
	f.emit("tool_execution_end", { toolCallId: "t1" })
	assert.match(f.messages.at(-1)!, /^Thinking · /)
	f.emit("message_update", { message: { role: "assistant", content: [] }, assistantMessageEvent: { type: "text_delta" } })
	assert.match(f.messages.at(-1)!, /^Writing/)
	f.emit("agent_settled")
	assert.equal(f.messages.at(-1), undefined, "settling clears the message")
	f.stop()
})

test("events before session_start or after settle are ignored", () => {
	const f = fixture()
	f.emit("agent_start")
	assert.deepEqual(f.messages, [])
	f.emit("session_start")
	f.emit("tool_execution_start", { toolCallId: "x", toolName: "read" })
	assert.deepEqual(f.messages, [], "a tool without an active run does not paint")
	f.stop()
})

test("session_shutdown clears the working message while the context is still known", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"] })
	const f = fixture()
	f.emit("session_start")
	f.emit("agent_start")
	assert.ok(f.messages.at(-1))
	f.emit("session_shutdown")
	assert.equal(f.messages.at(-1), undefined, "shutdown must call setWorkingMessage() to clear")
	f.emit("agent_start")
	assert.equal(f.messages.at(-1), undefined, "no painting after shutdown dropped the context")
})
