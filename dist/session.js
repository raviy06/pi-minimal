import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { setChromeMargin } from "./chrome.js";
import { loadPiMinimalConfig } from "./config.js";
import { installCwd } from "./cwd.js";
import { installFooter } from "./footer.js";
import { bindFooterContributionEvents } from "./footer-contribution-events.js";
import { createFooterContributions } from "./footer-contributions.js";
import { createGitState } from "./git-state.js";
import { installHeader } from "./header.js";
import { listSiblings, parseAgentList, parseTabList } from "./herdr.js";
import { applyReclaim, reclaimPolicy } from "./reclaim.js";
import { setSessionCwd } from "./tool-rows.js";
import { setEditDiffMode } from "./tools.js";
import { hideGauntletWidgets } from "./tracker.js";
const HERDR_FAST_MS = 2000;
const HERDR_SLOW_MS = 10000;
const HERDR_EXEC_TIMEOUT_MS = 3000;
/**
 * Everything pi-minimal owns for one session: config, cwd, the contribution registry, the git and
 * Herdr pollers, and the header/footer/status-line chrome. Disposal stops every timer and makes
 * late async results inert, so two sessions in one process never share or overwrite each other's
 * state. Non-TUI sessions get a session too, but it only binds the contribution protocol (which
 * replies `not-tui`) and installs no chrome.
 */
export function createSession(pi, ctx, deps) {
    const id = ctx.sessionManager.getSessionId();
    let alive = true;
    const contributions = createFooterContributions();
    const stopContributionEvents = bindFooterContributionEvents(pi.events, contributions, id, ctx.mode);
    if (ctx.mode !== "tui") {
        return { id, pin() { }, refreshGit() { }, dispose() { if (!alive)
                return; alive = false; stopContributionEvents(); } };
    }
    const config = loadPiMinimalConfig({ agentDir: getAgentDir(), cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
    setSessionCwd(ctx.cwd);
    setEditDiffMode(config.editDiff);
    try {
        const settings = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() });
        setChromeMargin(settings.getOutputPad());
    }
    catch {
        // Keep the current margin when settings are unavailable.
    }
    const gitState = createGitState(pi, () => ctx.cwd);
    let stopFooter = () => { };
    let siblings;
    let herdrTimer;
    let herdrPeriod = 0;
    let herdrInFlight;
    const settleTimers = [];
    const contextPct = () => {
        const usage = ctx.getContextUsage?.();
        const window = usage?.contextWindow || ctx.model?.contextWindow;
        if (typeof usage?.tokens !== "number" || !window)
            return undefined;
        return Math.max(0, Math.min(100, Math.round((usage.tokens / window) * 100)));
    };
    const installChromeFooter = () => {
        stopFooter();
        stopFooter = installFooter(ctx, {
            busy: deps.busy,
            editorText: () => (typeof ctx.ui.getEditorText === "function" ? ctx.ui.getEditorText() : ""),
            contextPct,
        }, contributions);
    };
    const installStatusLine = () => {
        installCwd(ctx, { gitState: gitState.get, siblings: () => siblings, onGitChange: gitState.onChange });
    };
    const pin = (reason) => {
        if (!alive)
            return;
        applyReclaim(reason, ctx.ui, {
            widgets: () => { if (config.hideGauntletWidgets)
                hideGauntletWidgets(ctx); },
            chrome: () => { installHeader(ctx); installChromeFooter(); },
        });
        if (!reclaimPolicy(reason).reinstallChrome)
            return;
        ctx.ui.setWidget("tw-cwd", undefined);
        installStatusLine();
    };
    const scheduleHerdr = (periodMs) => {
        if (!alive || herdrPeriod === periodMs)
            return;
        if (herdrTimer)
            clearInterval(herdrTimer);
        herdrPeriod = periodMs;
        herdrTimer = setInterval(() => { void probeHerdr(); }, periodMs);
    };
    const probeHerdr = async () => {
        if (!alive || herdrInFlight)
            return;
        const ac = new AbortController();
        herdrInFlight = ac;
        try {
            const agentRun = await pi.exec("herdr", ["agent", "list"], { timeout: HERDR_EXEC_TIMEOUT_MS, signal: ac.signal });
            if (!alive)
                return;
            const tabRun = await pi.exec("herdr", ["tab", "list"], { timeout: HERDR_EXEC_TIMEOUT_MS, signal: ac.signal });
            if (!alive)
                return;
            if (agentRun.code !== 0 || tabRun.code !== 0 || agentRun.killed || tabRun.killed) {
                siblings = undefined;
                scheduleHerdr(HERDR_SLOW_MS);
                return;
            }
            siblings = listSiblings(parseAgentList(agentRun.stdout), parseTabList(tabRun.stdout), process.env.HERDR_PANE_ID, process.env.HERDR_TAB_ID);
            scheduleHerdr(siblings ? HERDR_FAST_MS : HERDR_SLOW_MS);
        }
        catch {
            if (!alive)
                return;
            siblings = undefined;
            scheduleHerdr(HERDR_SLOW_MS);
        }
        finally {
            if (herdrInFlight === ac)
                herdrInFlight = undefined;
        }
    };
    // Install once, then re-assert shortly after: other extensions' session_start handlers may draw after ours.
    installHeader(ctx);
    installChromeFooter();
    installStatusLine();
    void gitState.refresh(true);
    pin("session_start");
    ctx.ui.setHiddenThinkingLabel("◆ Thought");
    ctx.ui.setWorkingIndicator();
    for (const delay of [0, 50])
        settleTimers.push(setTimeout(() => pin("session_settle"), delay));
    if (process.env.HERDR_ENV === "1")
        void probeHerdr();
    return {
        id,
        pin,
        refreshGit(force) { if (alive)
            void gitState.refresh(force); },
        dispose() {
            if (!alive)
                return;
            alive = false;
            for (const timer of settleTimers.splice(0))
                clearTimeout(timer);
            if (herdrTimer)
                clearInterval(herdrTimer);
            herdrTimer = undefined;
            herdrInFlight?.abort();
            herdrInFlight = undefined;
            siblings = undefined;
            gitState.dispose();
            stopFooter();
            stopContributionEvents();
        },
    };
}
