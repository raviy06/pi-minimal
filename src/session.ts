import { getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import { setChromeMargin } from "./chrome.js"
import { loadPiMinimalConfig } from "./config.js"
import { installCwd } from "./cwd.js"
import { installFooter } from "./footer.js"
import { bindFooterContributionEvents } from "./footer-contribution-events.js"
import { createFooterContributions } from "./footer-contributions.js"
import { createGitState } from "./git-state.js"
import { installHeader } from "./header.js"
import { createBackgroundTracker, type BackgroundTracker } from "./background.js"
import { backgroundSegment } from "./background-overlay.js"
import { createPrSource, findPrUrls, prSegment, type PrSource } from "./prs.js"
import { applyReclaim, reclaimPolicy, type ReclaimReason } from "./reclaim.js"
import type { RexSpawn } from "./rex.js"
import { createSiblingSource, type SiblingSource } from "./siblings.js"
import { setSessionCwd } from "./tool-rows.js"
import { setEditDiffMode } from "./tools.js"
import { hideGauntletWidgets } from "./tracker.js"

/** Custom session entry remembering a PR this session created, so a resumed session shows it. */
export const PR_ENTRY_TYPE = "pi-minimal.pr"

function readSessionPrs(ctx: ExtensionContext): string[] {
  const urls: string[] = []
  try {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== PR_ENTRY_TYPE) continue
      const url = (entry.data as { url?: unknown } | undefined)?.url
      if (typeof url === "string") urls.push(url)
    }
  } catch {
    // No branch available (tests, odd hosts): start empty.
  }
  return urls
}

export type SessionDeps = {
  /** Whether an agent run is in progress; owned by the extension because agent events are not session-scoped. */
  busy: () => boolean
  /** Test seam for the Rex event stream; defaults to node:child_process.spawn. */
  spawn?: RexSpawn
}

export type Session = {
  readonly id: string
  /** Background processes left behind by bash tool calls; undefined outside TUI mode. */
  readonly background?: BackgroundTracker
  readonly backgroundShortcut?: string | null
  /** Open PRs for the repo in cwd plus ones this session created; undefined outside TUI mode. */
  readonly prs?: PrSource
  /** Records PR URLs found in text (e.g. `gh pr create` output) as this session's PRs. */
  notePrUrls(text: string): void
  /** Re-asserts chrome after an event that may have let another extension draw over it. */
  pin(reason: ReclaimReason): void
  refreshGit(force?: boolean): void
  dispose(): void
}

/**
 * Everything pi-minimal owns for one session: config, cwd, the contribution registry, the git
 * poller, the sibling source (Herdr or Rex), and the header/footer/status-line chrome. Disposal stops every timer and makes
 * late async results inert, so two sessions in one process never share or overwrite each other's
 * state. Non-TUI sessions get a session too, but it only binds the contribution protocol (which
 * replies `not-tui`) and installs no chrome.
 */
export function createSession(pi: ExtensionAPI, ctx: ExtensionContext, deps: SessionDeps): Session {
  const id = ctx.sessionManager.getSessionId()
  let alive = true
  const contributions = createFooterContributions()
  const stopContributionEvents = bindFooterContributionEvents(pi.events, contributions, id, ctx.mode)
  if (ctx.mode !== "tui") {
    return { id, pin() {}, refreshGit() {}, notePrUrls() {}, dispose() { if (!alive) return; alive = false; stopContributionEvents() } }
  }

  const config = loadPiMinimalConfig({ agentDir: getAgentDir(), cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() })
  setSessionCwd(ctx.cwd)
  setEditDiffMode(config.editDiff)
  try {
    const settings = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() })
    setChromeMargin(settings.getOutputPad())
  } catch {
    // Keep the current margin when settings are unavailable.
  }

  const gitState = createGitState(pi, () => ctx.cwd)
  let stopFooter = () => {}
  let siblings: SiblingSource | undefined
  const background = createBackgroundTracker({ pi })
  const prs = createPrSource({ pi, cwd: () => ctx.cwd, sessionPrs: readSessionPrs(ctx) })
  const settleTimers: ReturnType<typeof setTimeout>[] = []

  const contextPct = (): number | undefined => {
    const usage = ctx.getContextUsage?.()
    const window = usage?.contextWindow || ctx.model?.contextWindow
    if (typeof usage?.tokens !== "number" || !window) return undefined
    return Math.max(0, Math.min(100, Math.round((usage.tokens / window) * 100)))
  }

  const installChromeFooter = () => {
    stopFooter()
    stopFooter = installFooter(ctx, {
      busy: deps.busy,
      editorText: () => (typeof ctx.ui.getEditorText === "function" ? ctx.ui.getEditorText() : ""),
      contextPct,
      prs: (theme) => {
        const snap = prs.get()
        return prSegment(snap.prs, theme, 4, snap.repo ? `${snap.repo.host}/${snap.repo.nameWithOwner}` : undefined)
      },
      onPrsChange: prs.onChange,
      background: () => backgroundSegment(background.get()),
      onBackgroundChange: background.onChange,
    }, contributions)
  }

  const installStatusLine = () => {
    installCwd(ctx, {
      gitState: gitState.get,
      siblings: () => siblings?.get(),
      onChange(listener) {
        const offGit = gitState.onChange(listener)
        const offSiblings = siblings?.onChange(listener) ?? (() => {})
        return () => { offGit(); offSiblings() }
      },
    })
  }

  const pin = (reason: ReclaimReason) => {
    if (!alive) return
    applyReclaim(reason, ctx.ui, {
      widgets: () => { if (config.hideGauntletWidgets) hideGauntletWidgets(ctx) },
      chrome: () => { installHeader(ctx); installChromeFooter() },
    })
    if (!reclaimPolicy(reason).reinstallChrome) return
    ctx.ui.setWidget("tw-cwd", undefined)
    installStatusLine()
  }

  // The source is chosen from the environment (HERDR_ENV, else REX_SESSION/REX_BLOCK); start it
  // before the status line so its onChange subscription is live.
  siblings = createSiblingSource({ pi, spawn: deps.spawn })

  // Install once, then re-assert shortly after: other extensions' session_start handlers may draw after ours.
  installHeader(ctx)
  installChromeFooter()
  installStatusLine()
  void gitState.refresh(true)
  pin("session_start")
  ctx.ui.setHiddenThinkingLabel("◆ Thought")
  ctx.ui.setWorkingIndicator()
  for (const delay of [0, 50]) settleTimers.push(setTimeout(() => pin("session_settle"), delay))

  return {
    id,
    background,
    backgroundShortcut: config.backgroundShortcut,
    prs,
    notePrUrls(text) {
      if (!alive) return
      const known = new Set(prs.sessionPrs())
      for (const url of findPrUrls(text)) {
        if (known.has(url)) continue
        prs.addSessionPr(url)
        try {
          pi.appendEntry?.(PR_ENTRY_TYPE, { url })
        } catch {
          // A session that cannot accept entries just forgets the PR on restart.
        }
      }
    },
    pin,
    refreshGit(force) { if (alive) { void gitState.refresh(force); void prs.refresh() } },
    dispose() {
      if (!alive) return
      alive = false
      for (const timer of settleTimers.splice(0)) clearTimeout(timer)
      background.dispose()
      prs.dispose()
      siblings?.dispose()
      siblings = undefined
      gitState.dispose()
      stopFooter()
      stopContributionEvents()
    },
  }
}
