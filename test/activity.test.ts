import assert from "node:assert/strict"
import test from "node:test"
import { activityBullet, rowIsRunning } from "../src/activity.js"

test("rowIsRunning is false when isPartial is false", () => {
	assert.equal(rowIsRunning({ isPartial: false }), false)
})

test("rowIsRunning is true when isPartial is true", () => {
	assert.equal(rowIsRunning({ isPartial: true }), true)
})

test("activityBullet(false, 0) returns ◆", () => {
	assert.equal(activityBullet(false, 0), "◆")
})

test("activityBullet(false, 1) returns ◆", () => {
	assert.equal(activityBullet(false, 1), "◆")
})

test("activityBullet(true, 0) returns ◆", () => {
	assert.equal(activityBullet(true, 0), "◆")
})

test("activityBullet(true, 1) returns ◇", () => {
	assert.equal(activityBullet(true, 1), "◇")
})
