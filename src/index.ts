import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import { loadPiMinimalConfig } from "./config.js"
import { installHeader } from "./header.js"
import { installFooter } from "./footer.js"
import { createFooterContributions } from "./footer-contributions.js"
import { bindFooterContributionEvents } from "./footer-contribution-events.js"
import { installCwd } from "./cwd.js"
import { listSiblings, parseAgentList, parseTabList, type Sibling } from "./herdr.js"
import { hideGauntletWidgets } from "./tracker.js"
import { installToolRenderers, stopLiveWatch } from "./tools.js"
import { applyReclaim, reclaimPolicy, type ReclaimReason } from "./reclaim.js"
import { installWorkingStatus } from "./working-status.js"
import { installTurnRule } from "./turn-rule.js"
import { installTranscript } from "./transcript.js"
import { createGitState } from "./git-state.js"
import { installCodeBox } from "./code-box.js"
import { setChromeMargin } from "./chrome.js"
import { SettingsManager } from "@earendil-works/pi-coding-agent"

export default function piMinimalExtension(pi: ExtensionAPI): void {
  const stopWorkingStatus = installWorkingStatus(pi)
  const stopTurnRule = installTurnRule(pi)
  installToolRenderers(pi)
  installTranscript(pi)
  installCodeBox()
  const contributions = createFooterContributions()
  let stopFooter = () => {}
  let stopContributionEvents = () => {}
  let sessionActive = false
  let fastTimer: ReturnType<typeof setInterval> | undefined
  let slowTimer: ReturnType<typeof setInterval> | undefined
  let stealTimer: ReturnType<typeof setInterval> | undefined
  let inFlight: AbortController | undefined
  let siblings: Sibling[] | undefined
  let generation = 0
  let hideWidgets = true
  let busy = false
  let currentCwd = process.cwd()
  const gitState = createGitState(pi, () => currentCwd)
  const stopTimers = () => {
    if (fastTimer) clearInterval(fastTimer)
    if (slowTimer) clearInterval(slowTimer)
    if (stealTimer) clearInterval(stealTimer)
    fastTimer = undefined
    slowTimer = undefined
    stealTimer = undefined
    inFlight?.abort()
    inFlight = undefined
  }

  const scheduleFast = (ctx: ExtensionContext) => {
    if (fastTimer) return
    if (slowTimer) clearInterval(slowTimer)
    slowTimer = undefined
    fastTimer = setInterval(() => {
      void probe(ctx)
    }, 2000)
  }

  const scheduleSlow = (ctx: ExtensionContext) => {
    if (slowTimer) return
    if (fastTimer) clearInterval(fastTimer)
    fastTimer = undefined
    slowTimer = setInterval(() => {
      void probe(ctx)
    }, 10000)
  }

  const probe = async (ctx: ExtensionContext) => {
    if (process.env.HERDR_ENV !== "1") return
    if (inFlight) return
    const ac = new AbortController()
    const gen = generation
    inFlight = ac
    try {
      const agentRun = await pi.exec("herdr", ["agent", "list"], {
        timeout: 3000,
        signal: ac.signal,
      })
      if (generation !== gen) return
      const tabRun = await pi.exec("herdr", ["tab", "list"], {
        timeout: 3000,
        signal: ac.signal,
      })
      if (generation !== gen) return
      if (agentRun.code !== 0 || tabRun.code !== 0 || agentRun.killed || tabRun.killed) {
        siblings = undefined
        scheduleSlow(ctx)
        return
      }
      siblings = listSiblings(
        parseAgentList(agentRun.stdout),
        parseTabList(tabRun.stdout),
        process.env.HERDR_PANE_ID,
        process.env.HERDR_TAB_ID,
      )
      if (siblings) scheduleFast(ctx)
      else scheduleSlow(ctx)
    } catch {
      if (generation !== gen) return
      siblings = undefined
      scheduleSlow(ctx)
    } finally {
      if (inFlight === ac) inFlight = undefined
    }
  }

  const hideForeignChrome = (ctx: ExtensionContext, reason: ReclaimReason) => {
    if (ctx.mode !== "tui") return
    applyReclaim(
      reason,
      ctx.ui,
      {
        widgets: () => {
          if (hideWidgets) hideGauntletWidgets(ctx)
        },
        chrome: () => {
          installHeader(ctx)
          installChromeFooter(ctx)
        },
      },
    )
  }

  const contextPct = (ctx: ExtensionContext): number | undefined => {
    const usage = ctx.getContextUsage?.()
    const window = usage?.contextWindow || ctx.model?.contextWindow
    if (typeof usage?.tokens !== "number" || !window) return undefined
    return Math.max(0, Math.min(100, Math.round((usage.tokens / window) * 100)))
  }

  const installChromeFooter = (ctx: ExtensionContext) => {
    stopFooter()
    stopFooter = installFooter(ctx, {
      busy: () => busy,
      editorText: () => (typeof ctx.ui.getEditorText === "function" ? ctx.ui.getEditorText() : ""),
      contextPct: () => contextPct(ctx),
    }, contributions)
  }

  const installStatusLine = (ctx: ExtensionContext) => {
    installCwd(ctx, {
      gitState: gitState.get,
      siblings: () => siblings,
      onGitChange: gitState.onChange,
    })
  }

  const pinChrome = (ctx: ExtensionContext, reason: ReclaimReason) => {
    hideForeignChrome(ctx, reason)
    if (ctx.mode !== "tui" || !reclaimPolicy(reason).reinstallChrome) return
    ctx.ui.setWidget("tw-cwd", undefined)
    installStatusLine(ctx)
  }

  pi.on("session_start", async (_event, ctx) => {
    stopFooter()
    stopContributionEvents()
    sessionActive = true
    generation += 1
    stopContributionEvents = bindFooterContributionEvents(pi.events, contributions, ctx.sessionManager.getSessionId(), ctx.mode)
    if (ctx.mode !== "tui") return
    const config = loadPiMinimalConfig({
      agentDir: getAgentDir(),
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
    })
    hideWidgets = config.hideGauntletWidgets
    currentCwd = ctx.cwd
    try {
      const settings = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() })
      setChromeMargin(settings.getOutputPad())
    } catch {
      // Keep the default margin when settings are unavailable.
    }
    installHeader(ctx)
    installChromeFooter(ctx)
    installStatusLine(ctx)
    void gitState.refresh(true)
    pinChrome(ctx, "session_start")
    ctx.ui.setHiddenThinkingLabel("◆ Thought")
    ctx.ui.setWorkingIndicator()
    const sessionGeneration = generation
    const settle = () => {
      if (sessionActive && generation === sessionGeneration) pinChrome(ctx, "session_settle")
    }
    setTimeout(settle, 0)
    setTimeout(settle, 50)
    if (!stealTimer) {
      stealTimer = setInterval(() => hideForeignChrome(ctx, "interval"), 200)
    }
    if (process.env.HERDR_ENV === "1") {
      await probe(ctx)
    }
  })

  pi.on("agent_start", () => {
    busy = true
  })
  pi.on("agent_end", () => {
    busy = false
    void gitState.refresh()
  })
  pi.on("turn_end", (_event, ctx) => {
    pinChrome(ctx, "turn_end")
    void gitState.refresh()
  })
  pi.on("tool_execution_end", (_event, ctx) => {
    pinChrome(ctx, "tool_execution_end")
    void gitState.refresh()
  })

  pi.on("session_shutdown", async () => {
    sessionActive = false
    stopFooter()
    stopContributionEvents()
    busy = false
    stopTimers()
    stopWorkingStatus()
    stopTurnRule()
    stopLiveWatch()
    generation += 1
    siblings = undefined
  })
}
