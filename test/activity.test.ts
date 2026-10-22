import assert from "node:assert/strict"
import test from "node:test"
import { rowIsRunning } from "../src/activity.js"

test("rowIsRunning is false when isPartial is false", () => {
	assert.equal(rowIsRunning({ isPartial: false }), false)
})

test("rowIsRunning is true when isPartial is true", () => {
	assert.equal(rowIsRunning({ isPartial: true }), true)
})

test("rowIsRunning is false once the row is done or errored", () => {
	assert.equal(rowIsRunning({ isPartial: true, state: { done: true } }), false)
	assert.equal(rowIsRunning({ isPartial: true, isError: true }), false)
})
