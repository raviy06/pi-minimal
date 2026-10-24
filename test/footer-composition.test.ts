import assert from "node:assert/strict"
import test from "node:test"
import { initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import { installFooter } from "../src/footer.js"
import { createFooterContributions, type ActivitySnapshot } from "../src/footer-contributions.js"

initTheme("dark", false)

type Factory = NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]>
function fixture() {
  let factory: Factory | undefined
  let renders = 0, branchSubscriptions = 0
  const ctx = { ui: { setFooter: (f: Factory) => { factory = f } }, sessionManager: { getBranch: () => [] } } as unknown as ExtensionContext
  const args = [
    { requestRender: () => { renders++ } },
    { fg: (_color: string, text: string) => text },
    { onBranchChange: () => { branchSubscriptions++; return () => { branchSubscriptions-- } } },
  ] as unknown as Parameters<Factory>
  return { ctx, mount: () => { assert.ok(factory); return factory(...args) },
    get renders() { return renders }, get branchSubscriptions() { return branchSubscriptions } }
}
const data = (revision: number, motion: "spinner" | "static" = "spinner"): ActivitySnapshot => ({
  revision, rows: [{ key: "1", agent: "worker", state: "running", text: "Last: tests" }], omitted: 0, motion, format: "icons",
})
const sources = { busy: () => false, editorText: () => "", contextPct: () => 10 }

test("no contributor preserves existing footer; activity is last even while typing/busy", () => {
  const f = fixture(), registry = createFooterContributions("S1")
  installFooter(f.ctx, sources)
  const baseline = f.mount(); const expected = baseline.render(80); baseline.dispose?.()
  const dispose = installFooter(f.ctx, sources, registry)
  const component = f.mount()
  assert.deepEqual(component.render(80), expected)
  const result = registry.register({ sessionId: "S1", owner: "activity" }); assert.ok(result.ok)
  result.registration.publish(data(0, "static"))
  const lines = component.render(80)
  assert.deepEqual(lines.slice(0, -1), expected)
  assert.ok(lines.at(-1)?.includes("◐ worker"))
  dispose(); component.dispose?.()
  const busyDispose = installFooter(f.ctx, { ...sources, busy: () => true, editorText: () => "draft" }, registry)
  const busy = f.mount()
  assert.equal(busy.render(80).length, 1)
  busyDispose()
})

test("updates invalidate; replacement disposes old mount but preserves session rows", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const f = fixture(), registry = createFooterContributions("S1")
  const result = registry.register({ sessionId: "S1", owner: "activity" }); assert.ok(result.ok)
  const stop = installFooter(f.ctx, sources, registry)
  const old = f.mount()
  result.registration.publish(data(0))
  const initial = f.renders
  t.mock.timers.tick(400)
  assert.equal(f.renders, initial + 1)
  assert.ok(old.render(80).at(-1)?.includes("◓"))
  stop(); old.dispose?.()
  assert.equal(f.branchSubscriptions, 0)
  const stopped = f.renders
  t.mock.timers.tick(800)
  assert.equal(f.renders, stopped)
  const stopNext = installFooter(f.ctx, sources, registry)
  const next = f.mount()
  assert.ok(next.render(80).at(-1)?.includes("worker"))
  result.registration.publish(data(1, "static"))
  const staticCount = f.renders
  t.mock.timers.tick(800)
  assert.equal(f.renders, staticCount)
  registry.reset(null)
  assert.deepEqual(next.render(80), next.render(80).filter(line => !line.includes("worker")))
  stopNext()
  assert.equal(f.branchSubscriptions, 0)
})

test("no spinner timer when terminal has no activity space", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const f = fixture(), registry = createFooterContributions("S1")
  const result = registry.register({ sessionId: "S1", owner: "activity" }); assert.ok(result.ok)
  result.registration.publish(data(0))
  const stop = installFooter(f.ctx, { ...sources, busy: () => true }, registry)
  const component = f.mount()
  component.render(0)
  const before = f.renders
  t.mock.timers.tick(800)
  assert.equal(f.renders, before)
  component.render(80)
  t.mock.timers.tick(400)
  assert.equal(f.renders, before + 1)
  stop()
})

test("legacy task summary precedes activity", () => {
  const f = fixture(), registry = createFooterContributions("S1")
  f.ctx.sessionManager.getBranch = () => [{ type: "message", message: { role: "toolResult", toolName: "plan_tracker", details: { tasks: [{ name: "Legacy task", status: "in_progress" }] } } }] as unknown as ReturnType<ExtensionContext["sessionManager"]["getBranch"]>
  const result = registry.register({ sessionId: "S1", owner: "activity" }); assert.ok(result.ok)
  result.registration.publish(data(0, "static"))
  const dispose = installFooter(f.ctx, sources, registry)
  const component = f.mount()
  const lines = component.render(80)
  assert.ok(lines.at(-2)?.includes("Legacy task"))
  assert.ok(lines.at(-1)?.includes("worker"))
  dispose()
})
