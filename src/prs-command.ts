import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { describePr, PR_LEGEND, type PrSource, type PullRequest } from "./prs.js"

/**
 * `/prs [mine|review|all]` lists the current repo's open PRs that involve me and offers actions on
 * the chosen one. The `list_open_prs` tool gives the model the same list.
 */

export type PrFilter = "all" | "mine" | "review"

export function parsePrFilter(args: string): PrFilter {
  const word = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  if (["mine", "author", "authored", "my"].includes(word)) return "mine"
  if (["review", "reviews", "review-requested", "requested"].includes(word)) return "review"
  return "all"
}

export function filterPrs(prs: PullRequest[], filter: PrFilter): PullRequest[] {
  if (filter === "all") return prs
  return prs.filter((pr) => pr.kind === filter)
}

const ACTIONS = ["Open in browser", "Paste URL into editor", "Checkout branch", "Cancel"] as const

export async function runPrsCommand(args: string, ctx: ExtensionContext, pi: ExtensionAPI, source: PrSource | undefined): Promise<void> {
  if (!source) {
    ctx.ui.notify("PRs are only tracked in interactive sessions.", "info")
    return
  }
  await source.refresh(true)
  const snap = source.get()
  if (!snap.repo) {
    ctx.ui.notify(snap.error ? `No GitHub repo here: ${snap.error}` : "No GitHub repo here.", "warning")
    return
  }
  const filter = parsePrFilter(args)
  const prs = filterPrs(snap.prs, filter)
  const title = `${snap.repo.nameWithOwner}: ${prs.length} open PR${prs.length === 1 ? "" : "s"}${filter === "all" ? "" : ` (${filter})`}${snap.error ? ` · stale: ${snap.error}` : ""}`
  if (prs.length === 0) {
    ctx.ui.notify(title, "info")
    return
  }
  if (ctx.mode !== "tui") {
    ctx.ui.notify(`${title}\n${prs.map((pr) => `${describePr(pr)}\n  ${pr.url}`).join("\n")}`, "info")
    return
  }
  const labels = prs.map(describePr)
  const chosen = await ctx.ui.select(`${title}\n${PR_LEGEND}`, labels)
  if (chosen === undefined) return
  const pr = prs[labels.indexOf(chosen)]
  if (!pr) return
  const action = await ctx.ui.select(`#${pr.number} ${pr.title}`, [...ACTIONS])
  if (action === "Open in browser") {
    const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    const run = await pi.exec(open, [pr.url])
    if (run.code !== 0) ctx.ui.notify(`Could not open browser: ${run.stderr.trim()}`, "error")
  } else if (action === "Paste URL into editor") {
    ctx.ui.pasteToEditor(pr.url)
  } else if (action === "Checkout branch") {
    const run = await pi.exec("gh", ["pr", "checkout", String(pr.number), "-R", pr.repo], { cwd: ctx.cwd, timeout: 60_000 })
    ctx.ui.notify(run.code === 0 ? `Checked out #${pr.number}` : `Checkout failed: ${run.stderr.trim()}`, run.code === 0 ? "info" : "error")
  }
}

export function prsToolResult(source: PrSource | undefined, filter: PrFilter) {
  const snap = source?.get()
  const prs = filterPrs(snap?.prs ?? [], filter).map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repo: pr.repo,
    author: pr.author,
    isDraft: pr.isDraft,
    kind: pr.kind,
    reviewDecision: pr.reviewDecision,
    ciFailing: pr.ciFailing,
    updatedAt: pr.updatedAt,
  }))
  return { repo: snap?.repo?.nameWithOwner, host: snap?.repo?.host, fetchedAt: snap?.fetchedAt, error: snap?.error, prs }
}
