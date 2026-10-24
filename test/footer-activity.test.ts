import assert from "node:assert/strict"
import test from "node:test"
import { visibleWidth } from "@earendil-works/pi-tui"
import { renderFooterActivity, activityNeedsAnimation } from "../src/footer-activity.js"
import { ACTIVITY_STATES, type ActivitySnapshot } from "../src/footer-contributions.js"

const theme = { fg: (_color: string, text: string) => text }
const snapshot = (): ActivitySnapshot => ({ revision: 0, rows: [{ key: "1", agent: "worker", state: "running", text: "Last: tests" }], omitted: 0, motion: "spinner", format: "icons" })

test("matches pi-minimal spinner/check/failure and explicit other state glyphs", () => {
  const glyphs = ["○", "◐", "!", "Ⅱ", "!", "✓", "✗", "⊘", "?"]
  for (const [i, state] of ACTIVITY_STATES.entries()) {
    const input = { ...snapshot(), rows: [{ ...snapshot().rows[0], state }] }
    const [line] = renderFooterActivity(input, 80, theme, 0)
    assert.ok(line.startsWith(glyphs[i]+" "), line)
    const plain = renderFooterActivity({ ...input, format: "plain" }, 80, theme, 1)[0]
    assert.ok(plain.includes(`[${state}]`))
  }
  assert.ok(renderFooterActivity(snapshot(), 80, theme, 1)[0].startsWith("◓"))
  assert.ok(renderFooterActivity({ ...snapshot(), motion: "static" }, 80, theme, 1)[0].startsWith("◐"))
})

test("caps rows, reports overflow, and only animates visible running rows", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ key: `${i}`, agent: "agent", state: "completed" as const, text: "Done" }))
  const input: ActivitySnapshot = { ...snapshot(), rows, omitted: 2 }
  const lines = renderFooterActivity(input, 80, theme)
  assert.equal(lines.length, 5)
  assert.ok(lines[4].includes("4 more"))
  assert.equal(activityNeedsAnimation(input), false)
  assert.equal(activityNeedsAnimation({ ...input, rows: [...rows, snapshot().rows[0]] }), false)
  assert.equal(activityNeedsAnimation(snapshot()), true)
  assert.equal(activityNeedsAnimation({ ...snapshot(), format: "plain" }), false)
  assert.equal(activityNeedsAnimation({ ...snapshot(), motion: "static" }), false)
  assert.deepEqual(renderFooterActivity(undefined, 80, theme), [])
  assert.deepEqual(renderFooterActivity({ ...snapshot(), rows: [] }, 80, theme), [])
})

test("bounds Unicode visible widths, strips controls, and limits nested indentation", () => {
  const input: ActivitySnapshot = { ...snapshot(), rows: [{ key: "p", agent: "工人👩‍💻é", state: "running", text: "\u001b[31mhello\nworld\u001b[0m" },
    { key: "c", parentKey: "p", agent: "child", state: "running", text: "test" }] }
  for (const width of [0, 1, 2, 20, 60, 80, 120]) {
    for (const format of ["icons", "plain"] as const) {
      for (const line of renderFooterActivity({ ...input, format }, width, theme)) {
        assert.ok(visibleWidth(line) <= width, `${width}: ${line}`)
        assert.ok(!line.includes("\n") && !line.includes("\u001b[31m"))
        // pi-tui adds its own safe SGR reset when truncating plain text.
        assert.ok(!line.replaceAll("\u001b[0m", "").includes("\u001b"))
      }
    }
  }
  assert.ok(renderFooterActivity(input, 80, theme)[1].startsWith("  ◐"))
})

test("right-aligns metrics and drops tokens then time before truncating activity", () => {
  const input: ActivitySnapshot = { ...snapshot(), rows: [{ ...snapshot().rows[0], metrics: { elapsedMs: 134000, tokens: 8200 }, task: { planId: "P12", id: "T3", status: "in_progress" } }] }
  const full = renderFooterActivity(input, 80, theme)[0]
  assert.ok(full.includes("T3 · Last: tests"))
  assert.ok(full.endsWith("2m 14s · 8.2k tok"))
  assert.equal(visibleWidth(full), 80)
  const timeOnly = renderFooterActivity(input, 40, theme)[0]
  assert.ok(timeOnly.endsWith("2m 14s"), timeOnly)
  assert.ok(!timeOnly.includes("tok"))
  const narrow = renderFooterActivity(input, 30, theme)[0]
  assert.ok(narrow.includes("T3 · Last: tests"))
  assert.ok(!narrow.includes("2m"))
})

test("missing metrics are not zero and completed elapsed values do not advance", () => {
  const input: ActivitySnapshot = { ...snapshot(), rows: [{ ...snapshot().rows[0], state: "completed", metrics: {} }] }
  assert.ok(renderFooterActivity(input, 80, theme)[0].endsWith("— · — tok"))
  const ended: ActivitySnapshot = { ...input, rows: [{ ...input.rows[0], metrics: { elapsedMs: 66000, tokens: 0 } }] }
  assert.ok(renderFooterActivity(ended, 80, theme, 0)[0].endsWith("1m 06s · 0 tok"))
  assert.equal(renderFooterActivity(ended, 80, theme, 0)[0], renderFooterActivity(ended, 80, theme, 1)[0])
})

test("task status is independent of agent status and plain mode keeps task labels", () => {
  for (const [status, marker] of [["blocked", "!"], ["in_review", "◇"], ["done", "✓"]] as const) {
    const input: ActivitySnapshot = { ...snapshot(), rows: [{ ...snapshot().rows[0], state: "completed", task: { planId: "P12", id: "T3", status } }] }
    assert.ok(renderFooterActivity(input, 80, theme)[0].includes(`${marker} T3`))
    const plain = renderFooterActivity({ ...input, format: "plain" }, 100, theme)[0]
    assert.ok(plain.includes(`[${status}] T3`))
    assert.ok(plain.includes("[completed]"))
  }
})

test("uses current semantic theme and never caches colored text", () => {
  const colors: string[] = []
  const themed = { fg: (color: string, text: string) => { colors.push(color); return text } }
  renderFooterActivity(snapshot(), 80, themed)
  assert.ok(colors.includes("warning"))
  const changed = renderFooterActivity(snapshot(), 80, { fg: (_c, text) => `<${text}>` })
  assert.ok(changed[0].includes("<◐>"))
})
