import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { stripTerminalSequences } from "@earendil-works/pi-tui"
import { filterPrs, parsePrFilter, prsToolResult } from "../src/prs-command.js"
import {
	ciFailing,
	createPrSource,
	describePr,
	parsePrList,
	parseRepoView,
	PR_LIST_FIELDS,
	prColor,
	prSegment,
	type PrRepo,
	type PullRequest,
} from "../src/prs.js"

const repo: PrRepo = { nameWithOwner: "raviy06/pi-minimal", host: "github.com", url: "https://github.com/raviy06/pi-minimal" }

// Shapes from `gh pr list --json …` on github.com and on a GitHub Enterprise host.
const ghList = JSON.stringify([
	{
		number: 23, title: "feat: background processes", url: "https://github.com/raviy06/pi-minimal/pull/23", isDraft: false,
		author: { login: "raviy06" }, reviewRequests: [], reviewDecision: "",
		statusCheckRollup: [{ state: null, conclusion: "", status: "IN_PROGRESS" }], updatedAt: "2026-10-28T13:40:00Z",
	},
	{
		number: 22, title: "feat: Rex siblings", url: "https://github.com/raviy06/pi-minimal/pull/22", isDraft: true,
		author: { login: "raviy06" }, reviewRequests: [], reviewDecision: "",
		statusCheckRollup: [{ state: null, conclusion: "SUCCESS", status: "COMPLETED" }], updatedAt: "2026-10-28T13:30:00Z",
	},
	{
		number: 21, title: "docs: glossary", url: "https://github.com/raviy06/pi-minimal/pull/21", isDraft: false,
		author: { login: "raviy06" }, reviewRequests: [], reviewDecision: "CHANGES_REQUESTED",
		statusCheckRollup: [], updatedAt: "2026-10-27T10:00:00Z",
	},
	{
		number: 20, title: "fix: review me", url: "https://github.com/raviy06/pi-minimal/pull/20", isDraft: false,
		author: { login: "someone" }, reviewRequests: [{ __typename: "User", login: "RaviY06" }], reviewDecision: "REVIEW_REQUIRED",
		statusCheckRollup: [{ state: "PENDING", conclusion: null, status: null }, { state: "FAILURE", conclusion: null, status: null }], updatedAt: "2026-10-28T09:00:00Z",
	},
	{
		number: 19, title: "team review", url: "https://github.com/raviy06/pi-minimal/pull/19", isDraft: false,
		author: { login: "someone" }, reviewRequests: [{ __typename: "Team", name: "HotelTonight", slug: "hoteltonight" }], reviewDecision: "",
		statusCheckRollup: [], updatedAt: "2026-10-28T08:00:00Z",
	},
	{
		number: 18, title: "just mentioned", url: "https://github.com/raviy06/pi-minimal/pull/18", isDraft: false,
		author: { login: "someone" }, reviewRequests: [], reviewDecision: "", statusCheckRollup: [], updatedAt: "2026-10-28T07:00:00Z",
	},
])

test.describe("prs parsing", () => {
	test("parseRepoView derives the host from the URL", () => {
		assert.deepEqual(parseRepoView(JSON.stringify({ nameWithOwner: "airbnb/ht-mainapp", url: "https://git.musta.ch/airbnb/ht-mainapp" })), {
			nameWithOwner: "airbnb/ht-mainapp", host: "git.musta.ch", url: "https://git.musta.ch/airbnb/ht-mainapp",
		})
		assert.throws(() => parseRepoView("{}"))
	})

	test("ciFailing reads both status contexts and check runs", () => {
		assert.equal(ciFailing([{ state: "SUCCESS" }, { conclusion: "SUCCESS", status: "COMPLETED" }]), false)
		assert.equal(ciFailing([{ state: "PENDING" }]), false)
		assert.equal(ciFailing([{ state: "FAILURE" }]), true)
		assert.equal(ciFailing([{ conclusion: "TIMED_OUT", status: "COMPLETED" }]), true)
		assert.equal(ciFailing(null), false)
	})

	test("parsePrList keeps mine and review-requested (case-insensitive), drops mentions, sorts reviews first", () => {
		const prs = parsePrList(ghList, repo, "raviy06")
		assert.deepEqual(prs.map((pr) => [pr.number, pr.kind]), [[20, "review"], [23, "mine"], [22, "mine"], [21, "mine"]])
		assert.equal(prs.find((pr) => pr.number === 20)?.ciFailing, true)
		assert.equal(prs.find((pr) => pr.number === 22)?.isDraft, true)
		assert.equal(prs[0]?.repo, "github.com/raviy06/pi-minimal")
	})

	test("team review requests count when my teams are known", () => {
		const prs = parsePrList(ghList, repo, "raviy06", ["HotelTonight"])
		assert.ok(prs.some((pr) => pr.number === 19 && pr.kind === "review"))
	})
})

test.describe("prs display", () => {
	const theme = { fg: (c: string, t: string) => `<${c}>${t}</${c}>` }
	const prs = parsePrList(ghList, repo, "raviy06")
	const by = (n: number) => prs.find((pr) => pr.number === n) as PullRequest

	test("prColor: trouble > review > draft > mine", () => {
		assert.equal(prColor(by(20)), "error", "failing CI on a review request")
		assert.equal(prColor(by(21)), "error", "changes requested")
		assert.equal(prColor({ ...by(20), ciFailing: false }), "warning")
		assert.equal(prColor(by(22)), "dim")
		assert.equal(prColor(by(23)), "accent")
	})

	test("prSegment links each chip, colours it, and collapses the overflow", () => {
		const segment = prSegment(prs, theme, 2) as string
		const esc = "\u001b"
		assert.ok(segment.includes(`<error>${esc}]8;;https://github.com/raviy06/pi-minimal/pull/20${esc}\\#20${esc}]8;;${esc}\\</error>`), "chip #20 is a red OSC 8 link")
		assert.match(segment, /<accent>.*#23.*<\/accent>/)
		assert.match(segment, /<dim>\+2<\/dim>$/)
		assert.equal(stripTerminalSequences(segment).replace(/[<>]/g, ""), "#20 #23 +2")
		assert.equal(prSegment([], theme), undefined)
	})

	test("describePr summarises kind and trouble", () => {
		assert.equal(describePr(by(20)), "#20  fix: review me  · review requested · CI failing · @someone")
		assert.equal(describePr(by(22)), "#22  feat: Rex siblings  · draft")
		assert.equal(describePr(by(21)), "#21  docs: glossary  · mine · changes requested")
	})

	test("filter parsing and filtering", () => {
		assert.equal(parsePrFilter(""), "all")
		assert.equal(parsePrFilter("mine"), "mine")
		assert.equal(parsePrFilter("Review extra"), "review")
		assert.deepEqual(filterPrs(prs, "review").map((pr) => pr.number), [20])
		assert.deepEqual(filterPrs(prs, "mine").map((pr) => pr.number), [23, 22, 21])
	})
})

test.describe("createPrSource", () => {
	const tick = () => new Promise((resolve) => setImmediate(resolve))
	const settle = async () => { for (let i = 0; i < 12; i++) await tick() }

	function fakePi(options: { repoOk?: boolean; login?: string } = {}) {
		const execCalls: string[][] = []
		const pi = {
			async exec(command: string, args: string[]) {
				execCalls.push([command, ...args])
				if (command !== "gh") return { stdout: "", stderr: "", code: 1, killed: false }
				if (args[0] === "repo") {
					return options.repoOk === false
						? { stdout: "", stderr: "none of the git remotes configured for this repository point to a known GitHub host", code: 1, killed: false }
						: { stdout: JSON.stringify({ nameWithOwner: repo.nameWithOwner, url: repo.url }), stderr: "", code: 0, killed: false }
				}
				if (args[0] === "api") return { stdout: `${options.login ?? "raviy06"}\n`, stderr: "", code: 0, killed: false }
				if (args[0] === "pr") return { stdout: ghList, stderr: "", code: 0, killed: false }
				return { stdout: "", stderr: "", code: 1, killed: false }
			},
		} as unknown as ExtensionAPI
		return { pi, execCalls }
	}

	test("fetches repo, viewer login (per host) and the PR list once; later refreshes reuse the repo and login", async (t) => {
		const { pi, execCalls } = fakePi()
		let now = 1_000_000
		const source = createPrSource({ pi, cwd: () => "/repo", now: () => now, minIntervalMs: 60_000, pollMs: 10 * 60_000 })
		t.after(() => source.dispose())
		let changes = 0
		source.onChange(() => { changes += 1 })
		await settle()
		assert.deepEqual(execCalls.map((c) => c.slice(0, 3)), [
			["gh", "repo", "view"],
			["gh", "api", "--hostname"],
			["gh", "pr", "list"],
		])
		assert.ok(execCalls[1]?.includes("github.com"))
		assert.ok(execCalls[2]?.includes("github.com/raviy06/pi-minimal") && execCalls[2]?.includes(PR_LIST_FIELDS))
		assert.equal(changes, 1)
		assert.deepEqual(source.get().prs.map((pr) => pr.number), [20, 23, 22, 21])
		assert.equal(source.get().fetchedAt, now)

		// Throttled: an event-driven refresh inside the window does nothing.
		await source.refresh()
		assert.equal(execCalls.length, 3)
		// Forced: only the list is fetched again; nothing changed so no notification.
		now += 1000
		await source.refresh(true)
		assert.equal(execCalls.length, 4)
		assert.equal(execCalls[3]?.[1], "pr")
		assert.equal(changes, 1)

		const tool = prsToolResult(source, "review")
		assert.equal(tool.repo, "raviy06/pi-minimal")
		assert.deepEqual(tool.prs.map((pr) => pr.number), [20])
	})

	test("outside a GitHub repo the snapshot is empty with the error, and no PR list is requested", async (t) => {
		const { pi, execCalls } = fakePi({ repoOk: false })
		const source = createPrSource({ pi, cwd: () => "/elsewhere", pollMs: 10 * 60_000 })
		t.after(() => source.dispose())
		await settle()
		assert.equal(execCalls.length, 1)
		assert.equal(source.get().repo, undefined)
		assert.deepEqual(source.get().prs, [])
		assert.match(source.get().error ?? "", /known GitHub host/)
	})
})
