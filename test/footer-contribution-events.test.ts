import assert from "node:assert/strict"
import test from "node:test"
import { EventEmitter } from "node:events"
import { createFooterContributions } from "../src/footer-contributions.js"
import { bindFooterContributionEvents, FOOTER_EVENTS, type RegisterRequest } from "../src/footer-contribution-events.js"

function bus() {
  const emitter = new EventEmitter()
  return { emit: (name: string, value: unknown) => { emitter.emit(name, value) },
    on: (name: string, handler: (value: unknown) => void) => { emitter.on(name, handler); return () => { emitter.off(name, handler) } } }
}
const request = (): RegisterRequest => ({ version: 1, sessionId: "S1", owner: "activity", slot: "activity" })

test("consumer-before-host registers on ready; host-before-consumer registers directly", () => {
  for (const consumerFirst of [true, false]) {
    const events = bus(), registry = createFooterContributions(), req = request()
    const register = () => events.emit(FOOTER_EVENTS.register, req)
    if (consumerFirst) events.on(FOOTER_EVENTS.ready, register)
    const dispose = bindFooterContributionEvents(events, registry, "S1", "tui")
    if (!consumerFirst) register()
    assert.equal(req.result?.ok, true)
    dispose()
    assert.equal(registry.read(), undefined)
  }
})

test("rejects foreign session, invalid version/slot and non-TUI requests", () => {
  const events = bus(), registry = createFooterContributions()
  let stop = bindFooterContributionEvents(events, registry, "S1", "tui")
  for (const changes of [{ sessionId: "S2" }, { version: 2 }, { slot: "sidebar" }]) {
    const req = { ...request(), ...changes }
    events.emit(FOOTER_EVENTS.register, req)
    assert.equal(req.result?.ok, false)
  }
  stop()
  stop = bindFooterContributionEvents(events, registry, "S1", "print")
  const req = request(); events.emit(FOOTER_EVENTS.register, req)
  assert.deepEqual(req.result, { ok: false, code: "not-tui" })
  stop()
})

test("summary and activity register independently through the public event", () => {
  const events = bus(), registry = createFooterContributions()
  const stop = bindFooterContributionEvents(events, registry, "S1", "tui")
  const activity = request(), plan: RegisterRequest = { ...request(), slot: "summary", owner: "tracker" }
  events.emit(FOOTER_EVENTS.register, activity)
  events.emit(FOOTER_EVENTS.register, plan)
  assert.ok(activity.result?.ok && plan.result?.ok)
  assert.ok(plan.result.registration.publish({ revision: 0, format: "icons", plan: { id: "P12", accepted: 3, total: 7, inReview: 1, blocked: 0 } }).ok)
  assert.equal(registry.readPlan()?.plan?.accepted, 3)
  stop()
})

test("shutdown removes listeners, invalidates handles and emits unavailable once", () => {
  const events = bus(), registry = createFooterContributions()
  let unavailable = 0
  events.on(FOOTER_EVENTS.unavailable, () => { unavailable++ })
  const stop = bindFooterContributionEvents(events, registry, "S1", "tui")
  const req = request(); events.emit(FOOTER_EVENTS.register, req)
  assert.ok(req.result?.ok)
  const handle = req.result.registration
  stop(); stop()
  assert.equal(unavailable, 1)
  const fresh = request(); events.emit(FOOTER_EVENTS.register, fresh)
  assert.equal(fresh.result, undefined)
  assert.deepEqual(handle.publish({}), { ok: false, code: "disposed" })
})

test("the plan slot accepts both its name and the legacy alias, and advertises all three", () => {
  const events = bus(), registry = createFooterContributions()
  let ready: { slots: string[] } | undefined
  events.on(FOOTER_EVENTS.ready, (value) => { ready = value as { slots: string[] } })
  bindFooterContributionEvents(events, registry, "S1", "tui")
  assert.ok(ready)
  assert.deepEqual(ready!.slots, ["activity", "plan", "summary"])
  const viaPlan: RegisterRequest = { ...request(), slot: "plan", owner: "a" }
  events.emit(FOOTER_EVENTS.register, viaPlan)
  assert.ok(viaPlan.result?.ok)
  const viaSummary: RegisterRequest = { ...request(), slot: "summary", owner: "b" }
  events.emit(FOOTER_EVENTS.register, viaSummary)
  assert.deepEqual(viaSummary.result, { ok: false, code: "occupied" }, "both names address the same slot")
})
