import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"

function builtinDarkTheme(): { colors: Record<string, string> } {
	const path = join("node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json")
	return JSON.parse(readFileSync(path, "utf8"))
}

const theme = JSON.parse(readFileSync("themes/minimal-dark.json", "utf8")) as {
	name: string
	appearance: string
	vars: Record<string, string>
	colors: Record<string, string>
}

test("minimal-dark is named after its file and targets dark terminals", () => {
	assert.equal(theme.name, "minimal-dark")
	assert.equal(theme.appearance, "dark")
	assert.ok(dirname("themes/minimal-dark.json").endsWith("themes"))
})

test("minimal-dark defines every color role the built-in dark theme defines", () => {
	const required = Object.keys(builtinDarkTheme().colors).sort()
	const provided = Object.keys(theme.colors).sort()
	assert.deepEqual(provided, required)
})

test("minimal-dark variable references resolve", () => {
	const isLiteral = (v: string) => v === "" || v.startsWith("#") || v.startsWith("okhsl(") || v.startsWith("oklch(")
	for (const [name, value] of Object.entries(theme.vars)) {
		if (!isLiteral(value)) assert.ok(value in theme.vars, `var ${name} -> ${value}`)
	}
	for (const [role, value] of Object.entries(theme.colors)) {
		if (!isLiteral(value)) assert.ok(value in theme.vars, `color ${role} -> ${value}`)
	}
})

test("minimal-dark frames code quietly and neutralises tool backgrounds", () => {
	assert.equal(theme.colors.mdCodeBlockBorder, "faint")
	assert.equal(theme.colors.mdCodeBlock, "text")
	assert.equal(theme.colors.toolSuccessBg, theme.colors.toolPendingBg)
	assert.notEqual(theme.colors.mdHeading, theme.colors.warning)
})
