import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { type TestContext } from "node:test"
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent"
import { loadPiMinimalConfig } from "../src/config.js"

function setup(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "pi-minimal-config-"))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const agentDir = join(root, "agent")
	const cwd = join(root, "project")
	mkdirSync(agentDir)
	mkdirSync(cwd)
	return { agentDir, cwd }
}

function writeGlobal(agentDir: string, contents: string) {
	writeFileSync(join(agentDir, "pi-minimal.json"), contents)
}

function writeProject(cwd: string, contents: string) {
	const dir = join(cwd, CONFIG_DIR_NAME)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "pi-minimal.json"), contents)
}

test("defaults hideGauntletWidgets to true", (t) => {
	const { agentDir, cwd } = setup(t)
	const error = t.mock.method(console, "error")
	const config = loadPiMinimalConfig({ agentDir, cwd, projectTrusted: true })
	assert.deepEqual(config, { hideGauntletWidgets: true })
	assert.equal(error.mock.callCount(), 0)
})

test("global false overrides default", (t) => {
	const { agentDir, cwd } = setup(t)
	writeGlobal(agentDir, JSON.stringify({ hideGauntletWidgets: false }))
	const error = t.mock.method(console, "error")
	const config = loadPiMinimalConfig({ agentDir, cwd, projectTrusted: false })
	assert.deepEqual(config, { hideGauntletWidgets: false })
	assert.equal(error.mock.callCount(), 0)
})

test("trusted project true overrides global false", (t) => {
	const { agentDir, cwd } = setup(t)
	writeGlobal(agentDir, JSON.stringify({ hideGauntletWidgets: false }))
	writeProject(cwd, JSON.stringify({ hideGauntletWidgets: true }))
	const error = t.mock.method(console, "error")
	const config = loadPiMinimalConfig({ agentDir, cwd, projectTrusted: true })
	assert.deepEqual(config, { hideGauntletWidgets: true })
	assert.equal(error.mock.callCount(), 0)
})

test("untrusted project false does not override global true", (t) => {
	const { agentDir, cwd } = setup(t)
	writeGlobal(agentDir, JSON.stringify({ hideGauntletWidgets: true }))
	writeProject(cwd, JSON.stringify({ hideGauntletWidgets: false }))
	const error = t.mock.method(console, "error")
	const config = loadPiMinimalConfig({ agentDir, cwd, projectTrusted: false })
	assert.deepEqual(config, { hideGauntletWidgets: true })
	assert.equal(error.mock.callCount(), 0)
})

test("omitted keys do not override", (t) => {
	const { agentDir, cwd } = setup(t)
	writeGlobal(agentDir, JSON.stringify({ hideGauntletWidgets: false }))
	writeProject(cwd, JSON.stringify({}))
	const error = t.mock.method(console, "error")
	const config = loadPiMinimalConfig({ agentDir, cwd, projectTrusted: true })
	assert.deepEqual(config, { hideGauntletWidgets: false })
	assert.equal(error.mock.callCount(), 0)
})

test("unknown keys do not override", (t) => {
	const { agentDir, cwd } = setup(t)
	writeGlobal(agentDir, JSON.stringify({ hideGauntletWidgets: false }))
	writeProject(cwd, JSON.stringify({ extra: true }))
	const error = t.mock.method(console, "error")
	const config = loadPiMinimalConfig({ agentDir, cwd, projectTrusted: true })
	assert.deepEqual(config, { hideGauntletWidgets: false })
	assert.equal(error.mock.callCount(), 0)
})

test("invalid JSON calls console.error and leaves the lower-precedence value unchanged", (t) => {
	const { agentDir, cwd } = setup(t)
	writeGlobal(agentDir, JSON.stringify({ hideGauntletWidgets: false }))
	writeProject(cwd, "{")
	const error = t.mock.method(console, "error")
	const config = loadPiMinimalConfig({ agentDir, cwd, projectTrusted: true })
	assert.deepEqual(config, { hideGauntletWidgets: false })
	assert.ok(error.mock.callCount() >= 1)
})

test("non-object root calls console.error and leaves the lower-precedence value unchanged", (t) => {
	const { agentDir, cwd } = setup(t)
	writeGlobal(agentDir, JSON.stringify({ hideGauntletWidgets: false }))
	writeProject(cwd, JSON.stringify(["hideGauntletWidgets", false]))
	const error = t.mock.method(console, "error")
	const config = loadPiMinimalConfig({ agentDir, cwd, projectTrusted: true })
	assert.deepEqual(config, { hideGauntletWidgets: false })
	assert.ok(error.mock.callCount() >= 1)
})

test("non-boolean hideGauntletWidgets calls console.error and leaves the lower-precedence value unchanged", (t) => {
	const { agentDir, cwd } = setup(t)
	writeGlobal(agentDir, JSON.stringify({ hideGauntletWidgets: false }))
	writeProject(cwd, JSON.stringify({ hideGauntletWidgets: "yes" }))
	const error = t.mock.method(console, "error")
	const config = loadPiMinimalConfig({ agentDir, cwd, projectTrusted: true })
	assert.deepEqual(config, { hideGauntletWidgets: false })
	assert.ok(error.mock.callCount() >= 1)
})
