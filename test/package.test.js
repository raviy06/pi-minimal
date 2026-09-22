import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

test("package manifest exposes the committed extension", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"))
  assert.equal(pkg.name, "pi-minimal")
  assert.equal(pkg.version, "0.1.0")
  assert.equal(pkg.license, "MIT")
  assert.equal(pkg.type, "module")
  assert.deepEqual(pkg.engines, { node: ">=22.19.0" })
  assert.deepEqual(pkg.keywords, ["pi-package"])
  assert.deepEqual(pkg.pi, { extensions: ["./dist/index.js"] })
  assert.deepEqual(pkg.peerDependencies, {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
  })
})
