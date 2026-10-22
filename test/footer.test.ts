import assert from "node:assert/strict"
import test from "node:test"
import { visibleWidth } from "@earendil-works/pi-tui"
import { footerHints } from "../src/footer.js"
import { contextBand, meter, splitRow } from "../src/cwd.js"

const hints = ["enter send", "shift+tab thinking"]

test("footerHints show only when idle with an empty editor", () => {
	assert.deepEqual(footerHints({ busy: () => false, editorText: () => "", contextPct: () => 10 }, hints), hints)
	assert.deepEqual(footerHints({ busy: () => true, editorText: () => "", contextPct: () => 10 }, hints), [])
	assert.deepEqual(footerHints({ busy: () => false, editorText: () => "hi", contextPct: () => 10 }, hints), [])
})

test("footerHints suggest /compact under context pressure", () => {
	assert.deepEqual(footerHints({ busy: () => false, editorText: () => "", contextPct: () => 72 }, hints), [...hints, "/compact"])
})

test("contextBand thresholds", () => {
	assert.equal(contextBand(0), "accent")
	assert.equal(contextBand(69), "accent")
	assert.equal(contextBand(70), "warning")
	assert.equal(contextBand(90), "error")
})

test("meter fills proportionally", () => {
	assert.equal(meter(0, "#", "."), "........")
	assert.equal(meter(50, "#", "."), "####....")
	assert.equal(meter(100, "#", "."), "########")
})

test("splitRow drops right-hand segments from the end before truncating the left", () => {
	assert.equal(splitRow("left", ["a", "b"], 12), "left    a  b")
	assert.equal(splitRow("left", ["aaaa", "bbbb"], 12), "left    aaaa")
	const squeezed = splitRow("a-very-long-left", ["x"], 10)
	assert.equal(visibleWidth(squeezed), 10)
	assert.ok(!squeezed.includes("x"))
})
