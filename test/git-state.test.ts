import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { createGitState, formatGitState, parseBranch, parsePorcelain } from "../src/git-state.js"

test("parseBranch returns the branch and treats detached HEAD as unknown", () => {
	assert.equal(parseBranch("main\n"), "main")
	assert.equal(parseBranch("HEAD\n"), undefined)
	assert.equal(parseBranch(""), undefined)
})

test("parsePorcelain counts changed paths", () => {
	assert.equal(parsePorcelain(""), 0)
	assert.equal(parsePorcelain(" M a.ts\n?? b.ts\n"), 2)
})

test("formatGitState shows ±N only when dirty", () => {
	assert.deepEqual(formatGitState(undefined), { branch: "", dirty: "" })
	assert.deepEqual(formatGitState({ branch: "main", dirty: 0 }), { branch: "main", dirty: "" })
	assert.deepEqual(formatGitState({ branch: "main", dirty: 3 }), { branch: "main", dirty: "±3" })
})

test("createGitState polls git, throttles, and notifies listeners", async () => {
	const calls: string[][] = []
	const pi = {
		async exec(_cmd: string, args: string[]) {
			calls.push(args)
			if (args[0] === "rev-parse") return { stdout: "feature\n", stderr: "", code: 0, killed: false }
			return { stdout: " M x\n", stderr: "", code: 0, killed: false }
		},
	} as unknown as ExtensionAPI
	const git = createGitState(pi, () => "/tmp", 60_000)
	let notified = 0
	git.onChange(() => (notified += 1))
	assert.equal(git.get(), undefined)
	await git.refresh(true)
	assert.deepEqual(git.get(), { branch: "feature", dirty: 1 })
	assert.equal(notified, 1)
	await git.refresh()
	assert.equal(calls.length, 2, "throttled refresh does not re-run git")
})

test("createGitState clears state outside a repository", async () => {
	const pi = {
		async exec() {
			return { stdout: "", stderr: "fatal: not a git repository", code: 128, killed: false }
		},
	} as unknown as ExtensionAPI
	const git = createGitState(pi, () => "/tmp")
	await git.refresh(true)
	assert.equal(git.get(), undefined)
})
