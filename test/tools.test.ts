import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { type TestContext } from "node:test"
import {
	SettingsManager,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { wrapBuiltinTools } from "../src/tools.js"

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR"
const originalAgentDir = process.env[AGENT_DIR_ENV]

function restoreEnv() {
	if (originalAgentDir === undefined) delete process.env[AGENT_DIR_ENV]
	else process.env[AGENT_DIR_ENV] = originalAgentDir
}

function setupDirs(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "pi-minimal-tools-"))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const agentDir = join(root, "agent")
	const cwd = join(root, "project")
	mkdirSync(agentDir)
	mkdirSync(cwd)
	return { agentDir, cwd }
}

test("untrusted project does not receive projectTrusted true", (t) => {
	const { agentDir, cwd } = setupDirs(t)
	process.env[AGENT_DIR_ENV] = agentDir
	t.after(restoreEnv)

	const create = t.mock.method(SettingsManager, "create")
	const pi = { registerTool() {} } as unknown as ExtensionAPI
	const ctx = {
		cwd,
		isProjectTrusted: () => false,
	} as unknown as ExtensionContext

	wrapBuiltinTools(pi, ctx)

	assert.equal(create.mock.callCount(), 1)
	const options = create.mock.calls[0].arguments[2] as { projectTrusted?: boolean } | undefined
	assert.equal(options?.projectTrusted, false)
})
