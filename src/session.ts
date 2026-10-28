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
import { createPrSource, prSegment, type PrSource } from "./prs.js"
import { applyReclaim, reclaimPolicy, type ReclaimReason } from "./reclaim.js"
import type { RexSpawn } from "./rex.js"
import { createSiblingSource, type SiblingSource } from "./siblings.js"
import { setSessionCwd } from "./tool-rows.js"
import { setEditDiffMode } from "./tools.js"
import { hideGauntletWidgets } from "./tracker.js"

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
  /** Open PRs for the repo in cwd; undefined outside TUI mode. */
  readonly prs?: PrSource
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
    return { id, pin() {}, refreshGit() {}, dispose() { if (!alive) return; alive = false; stopContributionEvents() } }
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
  const prs = createPrSource({ pi, cwd: () => ctx.cwd })
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
      prs: (theme) => prSegment(prs.get().prs, theme),
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
