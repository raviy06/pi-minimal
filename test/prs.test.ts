import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { stripTerminalSequences } from "@earendil-works/pi-tui"
import { filterPrs, parsePrFilter, prsToolResult } from "../src/prs-command.js"
import {
	ciFailing,
	createPrSource,
	describePr,
	findPrUrls,
	isPrCreateCommand,
	parsePrList,
	parsePrView,
	parseRepoView,
	PR_LIST_FIELDS,
	prChipLabel,
	prColor,
	prSegment,
	prUrlRepo,
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
	const theme = { fg: (c: string, t: string) => `[${c}]${t}[/${c}]` }
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
		const segment = prSegment(prs, theme, 2, "github.com/raviy06/pi-minimal") as string
		const esc = "\u001b"
		assert.ok(segment.includes(`[error]${esc}]8;;https://github.com/raviy06/pi-minimal/pull/20${esc}\\#20${esc}]8;;${esc}\\[/error]`), "chip #20 is a red OSC 8 link")
		assert.match(segment, /\[accent\].*#23.*\[\/accent\]/)
		assert.match(segment, /\[dim\]\+2\[\/dim\]$/)
		assert.equal(stripTerminalSequences(segment.replace(/\[\/?[a-z]+\]/g, "")), "#20 #23 +2")
		assert.equal(prSegment([], theme), undefined)
		assert.equal(stripTerminalSequences((prSegment(prs.slice(0, 1), theme, 4) as string).replace(/\[\/?[a-z]+\]/g, "")), "pi-minimal#20", "outside any repo the chip names its repo")
	})

	test("describePr summarises kind and trouble", () => {
		assert.equal(describePr(by(20), "github.com/raviy06/pi-minimal"), "#20  fix: review me  · review requested · CI failing · @someone")
		assert.equal(describePr(by(22), "github.com/raviy06/pi-minimal"), "#22  feat: Rex siblings  · draft")
		assert.equal(describePr(by(21), "github.com/raviy06/pi-minimal"), "#21  docs: glossary  · mine · changes requested")
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

	const sessionPrUrl = "https://git.musta.ch/airbnb/ht-mainapp/pull/22741"
	const ghView = (state = "OPEN") => JSON.stringify({
		number: 22741, title: "Make the Rails session cookie host-only", url: sessionPrUrl, isDraft: false, state,
		author: { login: "ravi-yadav" }, reviewRequests: [], reviewDecision: "REVIEW_REQUIRED",
		statusCheckRollup: [{ state: "FAILURE" }], updatedAt: "2026-10-28T12:00:00Z",
	})

	function fakePi(options: { repoOk?: boolean; login?: string; viewState?: string } = {}) {
		const execCalls: string[][] = []
		const pi = {
			async exec(command: string, args: string[]) {
				execCalls.push([command, ...args])
				if (command !== "gh") return { stdout: "", stderr: "", code: 1, killed: false }
				if (args[0] === "pr" && args[1] === "view") return { stdout: ghView(options.viewState), stderr: "", code: 0, killed: false }
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
		const hostnameIdx = execCalls[1]?.indexOf("--hostname") ?? -1
		assert.ok(hostnameIdx >= 0)
		assert.equal(execCalls[1]?.[hostnameIdx + 1], "github.com")
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

	test("a PR created in this session shows up even outside any repo, is persisted via sessionPrs(), and is forgotten once merged", async (t) => {
		const { pi, execCalls } = fakePi({ repoOk: false })
		const source = createPrSource({ pi, cwd: () => "/elsewhere", pollMs: 10 * 60_000 })
		t.after(() => source.dispose())
		await settle()
		assert.deepEqual(source.get().prs, [])

		source.addSessionPr("Creating pull request…\nhttps://git.musta.ch/airbnb/ht-mainapp/pull/22741\n")
		await settle()
		assert.deepEqual(source.sessionPrs(), [sessionPrUrl])
		assert.ok(execCalls.some((c) => c[1] === "pr" && c[2] === "view" && c[3] === sessionPrUrl))
		assert.deepEqual(source.get().prs.map((pr) => [pr.number, pr.kind, pr.repo, pr.ciFailing]), [[22741, "mine", "git.musta.ch/airbnb/ht-mainapp", true]])
		assert.equal(source.get().repo, undefined, "still not a repo here")

		// Same URL again is a no-op.
		const calls = execCalls.length
		source.addSessionPr(sessionPrUrl)
		await settle()
		assert.equal(execCalls.length, calls)

		// A restored session starts with the URL and fetches it on the first refresh.
		const restored = createPrSource({ pi, cwd: () => "/elsewhere", pollMs: 10 * 60_000, sessionPrs: [sessionPrUrl] })
		t.after(() => restored.dispose())
		await settle()
		assert.deepEqual(restored.get().prs.map((pr) => pr.number), [22741])
	})

	test("a session PR in the cwd repo is not listed twice; a merged one disappears", async (t) => {
		const merged = fakePi({ viewState: "MERGED" })
		const source = createPrSource({ pi: merged.pi, cwd: () => "/repo", pollMs: 10 * 60_000, sessionPrs: [sessionPrUrl, "https://github.com/raviy06/pi-minimal/pull/23"] })
		t.after(() => source.dispose())
		await settle()
		// #23 comes from the list (so no `pr view` for it); the GHE one was merged, so it is dropped and forgotten.
		assert.equal(merged.execCalls.filter((c) => c[1] === "pr" && c[2] === "view").length, 1)
		assert.deepEqual(source.get().prs.map((pr) => pr.number), [20, 23, 22, 21])
		assert.deepEqual(source.sessionPrs(), ["https://github.com/raviy06/pi-minimal/pull/23"])
	})
})

test.describe("session PRs", () => {
	test("PR URLs are found in gh pr create output and mapped to their repo", () => {
		const out = "Creating pull request for ry-prs-status into main in raviy06/pi-minimal\n\nhttps://github.com/raviy06/pi-minimal/pull/24\n"
		assert.deepEqual(findPrUrls(out), ["https://github.com/raviy06/pi-minimal/pull/24"])
		assert.deepEqual(findPrUrls("see https://git.musta.ch/airbnb/ht-mainapp/pull/22741 and https://git.musta.ch/airbnb/ht-mainapp/pull/22741"), ["https://git.musta.ch/airbnb/ht-mainapp/pull/22741"])
		assert.deepEqual(findPrUrls("https://github.com/raviy06/pi-minimal/issues/5"), [])
		assert.equal(prUrlRepo("https://git.musta.ch/airbnb/ht-mainapp/pull/22741"), "git.musta.ch/airbnb/ht-mainapp")
		assert.equal(isPrCreateCommand("cd x && gh pr create --fill"), true)
		assert.equal(isPrCreateCommand("gt submit --stack"), true)
		assert.equal(isPrCreateCommand("gh pr view 24"), false)
	})

	test("parsePrView keeps open PRs as mine and drops merged/closed ones", () => {
		const url = "https://git.musta.ch/airbnb/ht-mainapp/pull/22741"
		const raw = { number: 22741, title: "t", url, isDraft: false, author: { login: "x" }, statusCheckRollup: [], state: "OPEN" }
		assert.equal(parsePrView(JSON.stringify(raw), url)?.kind, "mine")
		assert.equal(parsePrView(JSON.stringify(raw), url)?.repo, "git.musta.ch/airbnb/ht-mainapp")
		assert.equal(parsePrView(JSON.stringify({ ...raw, state: "MERGED" }), url), undefined)
	})

	test("chips outside the cwd repo carry the repo name", () => {
		const pr = parsePrList(ghList, repo, "raviy06")[0] as PullRequest
		assert.equal(prChipLabel(pr, "github.com/raviy06/pi-minimal"), "#20")
		assert.equal(prChipLabel(pr, "git.musta.ch/airbnb/ht-mainapp"), "pi-minimal#20")
		assert.equal(prChipLabel(pr, undefined), "pi-minimal#20", "no cwd repo: name the repo")
		assert.match(describePr(pr, "git.musta.ch/airbnb/other"), /^pi-minimal#20 {2}/)
	})
})
