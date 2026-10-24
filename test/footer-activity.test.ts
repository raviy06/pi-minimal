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

test("uses current semantic theme and never caches colored text", () => {
  const colors: string[] = []
  const themed = { fg: (color: string, text: string) => { colors.push(color); return text } }
  renderFooterActivity(snapshot(), 80, themed)
  assert.ok(colors.includes("warning"))
  const changed = renderFooterActivity(snapshot(), 80, { fg: (_c, text) => `<${text}>` })
  assert.ok(changed[0].includes("<◐>"))
})
