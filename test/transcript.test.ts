import assert from "node:assert/strict"
import test from "node:test"
import { gutterThinking } from "../src/transcript.js"

test("gutterThinking prefixes paragraph starts only", () => {
	const input = "First thought\ncontinues here.\n\nSecond thought."
	assert.equal(gutterThinking(input), "┊ First thought\ncontinues here.\n\n┊ Second thought.")
})

test("gutterThinking leaves block syntax and fenced code alone", () => {
	const input = "# Heading\n\n- item one\n- item two\n\n```js\nconst x = 1\n\nconst y = 2\n```\n\n> quoted\n\nplain"
	assert.equal(
		gutterThinking(input),
		"# Heading\n\n- item one\n- item two\n\n```js\nconst x = 1\n\nconst y = 2\n```\n\n> quoted\n\n┊ plain",
	)
})

test("gutterThinking is idempotent and handles empty input", () => {
	assert.equal(gutterThinking(""), "")
	const once = gutterThinking("a\n\nb")
	assert.equal(gutterThinking(once), once)
})
