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

const lightness = (value: string) => {
	const resolved = value in theme.vars ? theme.vars[value] : value
	const m = /okhsl\(\s*[\d.]+\s+[\d.]+%\s+([\d.]+)%\s*\)/.exec(resolved)
	assert.ok(m, `okhsl literal for ${value}`)
	return Number(m![1]) / 100
}

test("minimal-dark keeps a readable grey ladder: text > muted > thinking > dim > faint", () => {
	const ladder = [theme.vars.text, theme.vars.muted, theme.colors.thinkingText, theme.vars.dim, theme.vars.faint].map(lightness)
	for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] < ladder[i - 1], `step ${i}: ${ladder.join(" > ")}`)
	// Readable tiers stay at or above L .56 (~4.4:1 on bg L .11, estimating Y ≈ L³).
	assert.ok(lightness(theme.vars.dim) >= 0.56)
	assert.ok(lightness(theme.colors.thinkingText) >= 0.56)
})

test("minimal-dark keeps status hues out of syntax colours", () => {
	const status = new Set([theme.colors.success, theme.colors.warning, theme.colors.error])
	for (const role of ["syntaxFunction", "syntaxNumber", "syntaxString", "syntaxVariable"]) {
		assert.ok(!status.has(theme.colors[role]), `${role} reuses a status colour`)
	}
})

test("minimal-dark draws no slab behind tool rows; only failures get a background", () => {
	assert.equal(theme.colors.toolSuccessBg, "bg")
	assert.equal(theme.colors.toolPendingBg, "bg")
	assert.notEqual(theme.colors.toolErrorBg, "bg")
})
