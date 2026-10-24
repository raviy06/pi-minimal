import assert from "node:assert/strict"
import test from "node:test"
import { visibleWidth } from "@earendil-works/pi-tui"
import { createFooterContributions } from "../src/footer-contributions.js"
import { renderFooterPlan, type PlanSnapshot } from "../src/footer-plan.js"

const sample: PlanSnapshot = { revision: 0, format: "icons", plan: { id: "P12", accepted: 3, total: 7, inReview: 1, blocked: 1 } }
const theme = { fg: (_color: string, text: string) => text }

test("plan slot is independent of activity and rejects invalid/stale snapshots", () => {
  const registry = createFooterContributions("S1")
  const activity = registry.register({ sessionId: "S1", owner: "activity" })
  const result = registry.registerPlan({ sessionId: "S1", owner: "tracker" })
  assert.ok(activity.ok && result.ok)
  assert.ok(result.registration.publish(sample).ok)
  assert.deepEqual(registry.readPlan(), sample)
  assert.ok(Object.isFrozen(registry.readPlan()?.plan))
  for (const payload of [sample, { ...sample, revision: 1, plan: { ...sample.plan, accepted: 8 } },
    { ...sample, revision: 1, plan: { ...sample.plan, total: -1 } },
    { ...sample, revision: 1, plan: { ...sample.plan, id: "bad\nlabel" } },
    { ...sample, revision: 1, plan: { ...sample.plan, inReview: 9 } },
    { ...sample, revision: 1, format: "html" }]) assert.equal(result.registration.publish(payload).ok, false)
  assert.equal(registry.read(), undefined)
  assert.ok(result.registration.publish({ revision: 1, format: "plain" }).ok)
  assert.equal(registry.readPlan()?.plan, undefined)
  registry.reset("S2")
  assert.equal(result.registration.publish({ ...sample, revision: 3 }).ok, false)
  assert.equal(registry.readPlan(), undefined)
})

test("violet slanted segments and exact count, with bounded large-plan progress", () => {
  const calls: string[] = []
  const colored = { fg: (color: string, text: string) => { calls.push(`${color}:${text}`); return text } }
  const [line] = renderFooterPlan(sample, 80, colored)
  assert.ok(line.includes("▰▰▰▱▱▱▱ 3/7"))
  assert.ok(calls.includes("accent:▰▰▰"))
  assert.ok(calls.includes("accent:Plan P12"))
  assert.ok(calls.includes("muted:▱▱▱▱"))
  const large = renderFooterPlan({ ...sample, plan: { id: "P12", accepted: 27, total: 100, inReview: 0, blocked: 0 } }, 80, theme)[0]
  assert.ok(large.includes("▰▰▱▱▱▱▱▱▱▱ 27/100"))
  assert.ok(renderFooterPlan({ ...sample, format: "plain" }, 80, theme)[0].includes("###.... 3/7"))
})

test("narrow layout drops segments before counts; empty plans and missing contributions are distinct", () => {
  const narrow = renderFooterPlan(sample, 45, theme)[0]
  assert.ok(!narrow.includes("▰") && narrow.includes("3/7"))
  for (const width of [0, 1, 20, 40, 60, 80, 120]) {
    for (const line of renderFooterPlan(sample, width, theme)) assert.ok(visibleWidth(line) <= width)
  }
  assert.deepEqual(renderFooterPlan(undefined, 80, theme), [])
  assert.deepEqual(renderFooterPlan({ revision: 0, format: "icons" }, 80, theme), [])
  assert.ok(renderFooterPlan({ ...sample, plan: { id: "P12", accepted: 0, total: 0, inReview: 0, blocked: 0 } }, 80, theme)[0].includes("No tasks yet"))
})
