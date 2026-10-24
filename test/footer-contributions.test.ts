import assert from "node:assert/strict"
import test from "node:test"
import { createFooterContributions, type ActivitySnapshot } from "../src/footer-contributions.js"

const snapshot = (revision = 0): ActivitySnapshot => ({
  revision, rows: [{ key: "child", agent: "worker", state: "running", text: "Last: tests" }],
  omitted: 0, motion: "spinner", format: "icons",
})

function owner() {
  const registry = createFooterContributions("S1")
  const result = registry.register({ sessionId: "S1", owner: "activity" })
  assert.equal(result.ok, true)
  return { registry, handle: result.registration }
}

test("empty registry, exclusive ownership and immutable snapshots", () => {
  const { registry, handle } = owner()
  assert.equal(registry.read(), undefined)
  assert.deepEqual(registry.register({ sessionId: "S2", owner: "other" }), { ok: false, code: "wrong-session" })
  assert.deepEqual(registry.register({ sessionId: "S1", owner: "other" }), { ok: false, code: "occupied" })
  const input = snapshot()
  assert.deepEqual(handle.publish(input), { ok: true })
  assert.notEqual(registry.read(), input)
  assert.ok(Object.isFrozen(registry.read()))
  assert.ok(Object.isFrozen(registry.read()?.rows[0]))
  assert.ok(Object.isFrozen(registry.read()?.rows))
})

test("rejects stale revisions and invalid payloads without replacing last good state", () => {
  const { registry, handle } = owner()
  handle.publish(snapshot(2))
  const good = registry.read()
  for (const invalid of [null, {}, snapshot(1), snapshot(2), { ...snapshot(3), revision: Infinity },
    { ...snapshot(3), omitted: -1 }, { ...snapshot(3), motion: "fast" },
    { ...snapshot(3), rows: [{ ...snapshot().rows[0], state: "invented" }] },
    { ...snapshot(3), rows: Array(65).fill(snapshot().rows[0]) },
    { ...snapshot(3), rows: [snapshot().rows[0], snapshot().rows[0]] },
    { ...snapshot(3), rows: [{ ...snapshot().rows[0], agent: "a".repeat(97) }] },
    { ...snapshot(3), rows: [{ ...snapshot().rows[0], parentKey: "missing" }] },
    { ...snapshot(3), rows: [{ ...snapshot().rows[0], parentKey: "child" }] },
    { ...snapshot(3), rows: [{ key: "a", parentKey: "b", agent: "x", text: "", state: "running" }, { key: "b", parentKey: "a", agent: "y", text: "", state: "running" }] },
  ]) {
    assert.equal(handle.publish(invalid).ok, false)
    assert.equal(registry.read(), good)
  }
})

test("sanitizes display controls, retains Unicode and clones caller data", () => {
  const { registry, handle } = owner()
  const input = { ...snapshot(), rows: [{ key: "c", agent: "工人", state: "running", text: "\u001b[31mtests\u001b[0m\nnext\u001b]0;evil\u0007\u202e" }] }
  assert.equal(handle.publish(input).ok, true)
  input.rows[0].text = "changed"
  assert.equal(registry.read()?.rows[0].text, "tests next")
  assert.equal(registry.read()?.rows[0].agent, "工人")
})

test("reset and stale disposer cannot change a newer owner, including the same session ID", () => {
  const { registry, handle } = owner()
  handle.publish(snapshot())
  registry.reset("S1")
  const next = registry.register({ sessionId: "S1", owner: "activity" })
  assert.ok(next.ok)
  if (!next.ok) return
  next.registration.publish(snapshot(0))
  handle.dispose()
  assert.equal(handle.publish(snapshot(99)).ok, false)
  assert.ok(registry.read())
  next.registration.dispose()
  next.registration.dispose()
  assert.equal(registry.read(), undefined)
  registry.reset(null)
  assert.equal(registry.register({ sessionId: "S1", owner: "activity" }).ok, false)
})

test("subscriptions observe valid changes only; one failing observer cannot break publication", () => {
  const { registry, handle } = owner()
  let changes = 0
  const stop = registry.subscribe(() => { changes++ })
  const stopBad = registry.subscribe(() => { throw new Error("disposed UI") })
  assert.equal(handle.publish(snapshot()).ok, true)
  handle.publish(snapshot())
  assert.equal(changes, 1)
  stop(); stopBad()
  handle.dispose()
  assert.equal(changes, 1)
})
