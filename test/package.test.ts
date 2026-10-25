import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

test("package manifest exposes the committed extension", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf8"))
	assert.equal(pkg.name, "pi-minimal")
	assert.equal(pkg.version, "0.3.0")
	const lock = JSON.parse(readFileSync("package-lock.json", "utf8"))
	assert.equal(lock.version, pkg.version, "lockfile root version matches package")
	assert.equal(lock.packages[""].version, pkg.version, "lockfile package version matches package")
	assert.ok(readFileSync("CHANGELOG.md", "utf8").includes(`## [${pkg.version}] - `), "version has a dated release entry")
	assert.equal(pkg.license, "MIT")
	assert.equal(pkg.type, "module")
	assert.deepEqual(pkg.engines, { node: ">=22.19.0" })
	assert.deepEqual(pkg.keywords, ["pi-package"])
	assert.deepEqual(pkg.repository, { type: "git", url: "git+https://github.com/raviy06/pi-minimal.git" })
	assert.deepEqual(pkg.pi, { extensions: ["./dist/index.js"], themes: ["./themes/minimal-dark.json"] })
	assert.deepEqual(pkg.peerDependencies, {
		"@earendil-works/pi-coding-agent": "*",
		"@earendil-works/pi-tui": "*",
	})
})
