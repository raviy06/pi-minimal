import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { hyperlink } from "@earendil-works/pi-tui"
import { createListeners } from "./listeners.js"

/**
 * Open pull requests for the repository the session is in, via the `gh` CLI: the ones I authored
 * and the ones waiting on my review. Shown on the status line as clickable `#1675` chips (OSC 8
 * links), coloured by kind, and listed by `/prs`.
 *
 * `gh` resolves the host from the repo's remote, so GitHub.com and GitHub Enterprise both work;
 * the viewer login is looked up per host because it differs between them.
 */

export type PrKind = "mine" | "review"

export type PullRequest = {
  number: number
  title: string
  url: string
  /** `host/owner/repo`, the form `gh -R` accepts for any host. */
  repo: string
  author: string
  isDraft: boolean
  /** Why it is on my list. A PR I authored that also requests my review counts as `mine`. */
  kind: PrKind
  /** GitHub's review decision: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or empty. */
  reviewDecision: string
  /** Any status context or check run failed. */
  ciFailing: boolean
  updatedAt: string
}

export type PrRepo = {
  /** `owner/repo` */
  nameWithOwner: string
  /** e.g. `github.com` */
  host: string
  url: string
}

export type PrSnapshot = {
  repo?: PrRepo
  /** The cwd repo's PRs first, then PRs created in this session elsewhere (deduped by URL). */
  prs: PullRequest[]
  /** Last `gh` error, when the list could not be refreshed. */
  error?: string
  fetchedAt?: number
}

export const PR_LIST_FIELDS = "number,title,url,isDraft,author,reviewRequests,reviewDecision,statusCheckRollup,updatedAt"

/** A GitHub PR URL on any host: `https://host/owner/repo/pull/123`. */
export const PR_URL_RE = /https?:\/\/([a-z0-9.-]+)\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)\b/gi

/** Finds PR URLs in text, e.g. the output of `gh pr create`. */
export function findPrUrls(text: string): string[] {
  const urls = new Set<string>()
  for (const match of text.matchAll(PR_URL_RE)) urls.add(`https://${match[1]}/${match[2]}/${match[3]}/pull/${match[4]}`)
  return [...urls]
}

/** Repo (`host/owner/repo`) a PR URL belongs to. */
export function prUrlRepo(url: string): string | undefined {
  const match = new RegExp(PR_URL_RE.source, "i").exec(url)
  return match ? `${match[1]}/${match[2]}/${match[3]}` : undefined
}

/** Commands whose output announces a PR this session created. */
export function isPrCreateCommand(command: string): boolean {
  return /\bgh\s+pr\s+create\b|\bgt\s+submit\b/.test(command)
}

/** Parses `gh repo view --json nameWithOwner,url`. */
export function parseRepoView(stdout: string): PrRepo {
  const data = JSON.parse(stdout) as { nameWithOwner?: unknown; url?: unknown }
  if (typeof data.nameWithOwner !== "string" || typeof data.url !== "string") throw new Error("invalid gh repo view")
  return { nameWithOwner: data.nameWithOwner, host: new URL(data.url).host, url: data.url }
}

type RawCheck = { state?: string | null; conclusion?: string | null; status?: string | null }
type RawPr = {
  number?: unknown
  title?: unknown
  url?: unknown
  isDraft?: unknown
  author?: { login?: unknown } | null
  reviewRequests?: Array<{ __typename?: string; login?: unknown; slug?: unknown; name?: unknown }> | null
  reviewDecision?: unknown
  statusCheckRollup?: RawCheck[] | null
  updatedAt?: unknown
}

const FAILED_STATES = new Set(["FAILURE", "ERROR"])
const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"])

export function ciFailing(checks: RawCheck[] | null | undefined): boolean {
  return (checks ?? []).some(
    (check) => FAILED_STATES.has(check.state ?? "") || FAILED_CONCLUSIONS.has(check.conclusion ?? ""),
  )
}

function toPullRequest(raw: RawPr, repo: string, kind: PrKind): PullRequest | undefined {
  if (typeof raw.number !== "number" || typeof raw.url !== "string") return undefined
  return {
    number: raw.number,
    title: typeof raw.title === "string" ? raw.title : "",
    url: raw.url,
    repo,
    author: typeof raw.author?.login === "string" ? raw.author.login : "",
    isDraft: raw.isDraft === true,
    kind,
    reviewDecision: typeof raw.reviewDecision === "string" ? raw.reviewDecision : "",
    ciFailing: ciFailing(raw.statusCheckRollup),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  }
}

/** Parses `gh pr view URL --json …` for a PR this session created (always `mine`). */
export function parsePrView(stdout: string, url: string): PullRequest | undefined {
  const raw = JSON.parse(stdout) as RawPr & { state?: unknown }
  if (raw.state !== undefined && raw.state !== "OPEN") return undefined
  const repo = prUrlRepo(url)
  return repo ? toPullRequest(raw, repo, "mine") : undefined
}

/**
 * Parses `gh pr list --json …` for `involves:@me` into my PRs: authored by `login`, or requesting
 * my review (directly; team requests are included when `teams` lists my team slugs). Others I'm
 * merely mentioned on are dropped.
 */
export function parsePrList(stdout: string, repo: PrRepo, login: string, teams: readonly string[] = []): PullRequest[] {
  const data = JSON.parse(stdout) as RawPr[]
  if (!Array.isArray(data)) throw new Error("invalid gh pr list")
  const teamSet = new Set(teams.map((team) => team.toLowerCase()))
  const prs: PullRequest[] = []
  for (const raw of data) {
    const author = typeof raw.author?.login === "string" ? raw.author.login : ""
    const requested = (raw.reviewRequests ?? []).some((request) => {
      if (typeof request.login === "string") return request.login.toLowerCase() === login.toLowerCase()
      const slug = typeof request.slug === "string" ? request.slug : typeof request.name === "string" ? request.name : ""
      return teamSet.has(slug.toLowerCase())
    })
    const mine = author.toLowerCase() === login.toLowerCase()
    if (!mine && !requested) continue
    const pr = toPullRequest(raw, `${repo.host}/${repo.nameWithOwner}`, mine ? "mine" : "review")
    if (pr) prs.push(pr)
  }
  // Review requests first (they need me), then mine; newest first within each.
  prs.sort((a, b) => (a.kind === b.kind ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.kind === "review" ? -1 : 1))
  return prs
}

export type PrColor = "accent" | "dim" | "warning" | "error"

/** Chip colour: trouble (failing CI, changes requested) wins, then review requests, then drafts. */
export function prColor(pr: PullRequest): PrColor {
  if (pr.ciFailing || pr.reviewDecision === "CHANGES_REQUESTED") return "error"
  if (pr.kind === "review") return "warning"
  if (pr.isDraft) return "dim"
  return "accent"
}

export const PR_LEGEND = "#n mine · dim draft · amber needs my review · red failing CI / changes requested"

type Theme = { fg(color: string, text: string): string }

/** `#1675` inside the cwd repo; `repo#1675` for a PR elsewhere (created in this session) or when cwd is no repo. */
export function prChipLabel(pr: PullRequest, cwdRepo?: string): string {
  if (cwdRepo && pr.repo === cwdRepo) return `#${pr.number}`
  return `${pr.repo.split("/").pop()}#${pr.number}`
}

/** Footer segment: `#1675 #1670 +3` with each number an OSC 8 link; undefined when empty. */
export function prSegment(prs: PullRequest[], theme: Theme, max = 4, cwdRepo?: string): string | undefined {
  if (prs.length === 0) return undefined
  const shown = prs.slice(0, max)
  const chips = shown.map((pr) => theme.fg(prColor(pr), hyperlink(prChipLabel(pr, cwdRepo), pr.url)))
  const rest = prs.length - shown.length
  if (rest > 0) chips.push(theme.fg("dim", `+${rest}`))
  return chips.join(" ")
}

export function describePr(pr: PullRequest, cwdRepo?: string): string {
  const flags = [
    pr.kind === "review" ? "review requested" : pr.isDraft ? "draft" : "mine",
    pr.ciFailing ? "CI failing" : undefined,
    pr.reviewDecision === "CHANGES_REQUESTED" ? "changes requested" : pr.reviewDecision === "APPROVED" ? "approved" : undefined,
  ].filter(Boolean)
  return `${prChipLabel(pr, cwdRepo)}  ${pr.title}  · ${flags.join(" · ")}${pr.kind === "review" ? ` · @${pr.author}` : ""}`
}

export type PrSource = {
  get(): PrSnapshot
  onChange(listener: () => void): () => void
  /** Re-fetch now (throttled unless `force`). */
  refresh(force?: boolean): Promise<void>
  /** Remember a PR this session created (any repo); it is shown until it is no longer open. */
  addSessionPr(url: string): void
  /** URLs remembered via addSessionPr, for persistence. */
  sessionPrs(): string[]
  dispose(): void
}

export type PrSourceDeps = {
  pi: ExtensionAPI
  cwd: () => string
  /** PR URLs restored from a previous run of this session. */
  sessionPrs?: readonly string[]
  now?: () => number
  /** Poll period; 3 min by default. */
  pollMs?: number
  /** Minimum gap between refreshes triggered by events. */
  minIntervalMs?: number
}

const GH_TIMEOUT_MS = 15_000
const DEFAULT_POLL_MS = 3 * 60_000
const DEFAULT_MIN_INTERVAL_MS = 60_000

export function createPrSource(deps: PrSourceDeps): PrSource {
  const now = deps.now ?? Date.now
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS
  const minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const listeners = createListeners()
  let alive = true
  let state: PrSnapshot = { prs: [] }
  let inFlight: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastRun = 0
  const logins = new Map<string, string>()
  const session = new Set<string>(deps.sessionPrs ?? [])

  // Only what is displayed counts as a change; a refresh that confirms the same list is silent.
  const visible = (snap: PrSnapshot) => JSON.stringify([snap.repo, snap.prs, snap.error])
  const set = (next: PrSnapshot) => {
    const changed = visible(next) !== visible(state)
    state = next
    if (changed) listeners.notify()
  }

  const gh = (args: string[]) => deps.pi.exec("gh", args, { cwd: deps.cwd(), timeout: GH_TIMEOUT_MS })

  const viewerLogin = async (host: string): Promise<string | undefined> => {
    const cached = logins.get(host)
    if (cached) return cached
    const run = await gh(["api", "--hostname", host, "user", "--jq", ".login"])
    if (run.code !== 0) return undefined
    const login = run.stdout.trim()
    if (login) logins.set(host, login)
    return login || undefined
  }

  /** PRs this session created, wherever they live; a merged or closed one is forgotten. */
  const fetchSessionPrs = async (exclude: Set<string>): Promise<PullRequest[]> => {
    const extra = await Promise.all(
      [...session].filter((url) => !exclude.has(url)).map(async (url) => {
        const view = await gh(["pr", "view", url, "--json", `${PR_LIST_FIELDS},state`])
        if (view.code !== 0) return undefined
        try {
          const pr = parsePrView(view.stdout, url)
          if (!pr) session.delete(url)
          return pr
        } catch {
          return undefined
        }
      }),
    )
    return extra.filter((pr): pr is PullRequest => pr !== undefined)
  }

  const fetchOnce = async (): Promise<void> => {
    let repo = state.repo
    let repoError: string | undefined
    try {
      if (!repo) {
        const view = await gh(["repo", "view", "--json", "nameWithOwner,url"])
        if (!alive) return
        if (view.code === 0) repo = parseRepoView(view.stdout)
        else repoError = view.stderr.trim() || "gh repo view failed"
      }
      let prs: PullRequest[] = []
      let error = repoError
      if (repo) {
        const login = await viewerLogin(repo.host)
        if (!alive) return
        if (!login) {
          error = `gh is not authenticated for ${repo.host}`
        } else {
          const list = await gh([
            "pr", "list", "-R", `${repo.host}/${repo.nameWithOwner}`, "--state", "open", "--limit", "100",
            "--search", "involves:@me", "--json", PR_LIST_FIELDS,
          ])
          if (!alive) return
          if (list.code !== 0) error = list.stderr.trim() || "gh pr list failed"
          else prs = parsePrList(list.stdout, repo, login)
        }
      }
      // Outside a GitHub repo, or when the list failed, the session's own PRs still show.
      prs.push(...(await fetchSessionPrs(new Set(prs.map((pr) => pr.url)))))
      if (!alive) return
      set({ repo, prs: error && prs.length === 0 && state.prs.length > 0 ? state.prs : prs, error, fetchedAt: now() })
    } catch (error) {
      if (!alive) return
      set({ repo, prs: state.prs, error: error instanceof Error ? error.message : String(error), fetchedAt: state.fetchedAt })
    }
  }

  const schedule = () => {
    if (!alive) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void refresh(true) }, pollMs)
    timer.unref?.()
  }

  const refresh = (force = false): Promise<void> => {
    if (!alive) return Promise.resolve()
    if (inFlight) return inFlight
    if (!force && now() - lastRun < minIntervalMs) return Promise.resolve()
    lastRun = now()
    inFlight = fetchOnce().finally(() => {
      inFlight = undefined
      schedule()
    })
    return inFlight
  }

  void refresh(true)

  return {
    get: () => state,
    onChange: listeners.add,
    refresh,
    addSessionPr(url) {
      const found = findPrUrls(url)[0]
      if (!found || session.has(found)) return
      session.add(found)
      void refresh(true)
    },
    sessionPrs: () => [...session],
    dispose() {
      if (!alive) return
      alive = false
      if (timer) clearTimeout(timer)
      timer = undefined
      listeners.clear()
    },
  }
}
