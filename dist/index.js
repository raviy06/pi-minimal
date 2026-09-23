import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadPiMinimalConfig } from "./config.js";
import { installHeader } from "./header.js";
import { installFooter } from "./footer.js";
import { installCwd } from "./cwd.js";
import { listSiblings, parseAgentList, parseTabList } from "./herdr.js";
import { hideGauntletWidgets } from "./tracker.js";
import { stopLiveWatch, wrapBuiltinTools } from "./tools.js";
import { applyReclaim, reclaimPolicy } from "./reclaim.js";
import { installWorkingStatus } from "./working-status.js";
export default function piMinimalExtension(pi) {
    const stopWorkingStatus = installWorkingStatus(pi);
    let fastTimer;
    let slowTimer;
    let stealTimer;
    let inFlight;
    let siblings;
    let generation = 0;
    let hideWidgets = true;
    const stopTimers = () => {
        if (fastTimer)
            clearInterval(fastTimer);
        if (slowTimer)
            clearInterval(slowTimer);
        if (stealTimer)
            clearInterval(stealTimer);
        fastTimer = undefined;
        slowTimer = undefined;
        stealTimer = undefined;
        inFlight?.abort();
        inFlight = undefined;
    };
    const scheduleFast = (ctx) => {
        if (fastTimer)
            return;
        if (slowTimer)
            clearInterval(slowTimer);
        slowTimer = undefined;
        fastTimer = setInterval(() => {
            void probe(ctx);
        }, 2000);
    };
    const scheduleSlow = (ctx) => {
        if (slowTimer)
            return;
        if (fastTimer)
            clearInterval(fastTimer);
        fastTimer = undefined;
        slowTimer = setInterval(() => {
            void probe(ctx);
        }, 10000);
    };
    const probe = async (ctx) => {
        if (process.env.HERDR_ENV !== "1")
            return;
        if (inFlight)
            return;
        const ac = new AbortController();
        const gen = generation;
        inFlight = ac;
        try {
            const agentRun = await pi.exec("herdr", ["agent", "list"], {
                timeout: 3000,
                signal: ac.signal,
            });
            if (generation !== gen)
                return;
            const tabRun = await pi.exec("herdr", ["tab", "list"], {
                timeout: 3000,
                signal: ac.signal,
            });
            if (generation !== gen)
                return;
            if (agentRun.code !== 0 || tabRun.code !== 0 || agentRun.killed || tabRun.killed) {
                siblings = undefined;
                scheduleSlow(ctx);
                return;
            }
            siblings = listSiblings(parseAgentList(agentRun.stdout), parseTabList(tabRun.stdout), process.env.HERDR_PANE_ID, process.env.HERDR_TAB_ID);
            if (siblings)
                scheduleFast(ctx);
            else
                scheduleSlow(ctx);
        }
        catch {
            if (generation !== gen)
                return;
            siblings = undefined;
            scheduleSlow(ctx);
        }
        finally {
            if (inFlight === ac)
                inFlight = undefined;
        }
    };
    const hideForeignChrome = (ctx, reason) => {
        if (ctx.mode !== "tui")
            return;
        applyReclaim(reason, ctx.ui, {
            widgets: () => {
                if (hideWidgets)
                    hideGauntletWidgets(ctx);
            },
            chrome: () => {
                installHeader(ctx);
                installFooter(ctx, () => siblings);
            },
        });
    };
    const pinChrome = (ctx, reason) => {
        hideForeignChrome(ctx, reason);
        if (ctx.mode !== "tui" || !reclaimPolicy(reason).reinstallChrome)
            return;
        ctx.ui.setWidget("tw-cwd", undefined);
        installCwd(ctx);
    };
    pi.on("session_start", async (_event, ctx) => {
        if (ctx.mode !== "tui")
            return;
        const config = loadPiMinimalConfig({
            agentDir: getAgentDir(),
            cwd: ctx.cwd,
            projectTrusted: ctx.isProjectTrusted(),
        });
        hideWidgets = config.hideGauntletWidgets;
        installHeader(ctx);
        installFooter(ctx, () => siblings);
        installCwd(ctx);
        wrapBuiltinTools(pi, ctx);
        pinChrome(ctx, "session_start");
        ctx.ui.setHiddenThinkingLabel("◆ Thought");
        ctx.ui.setWorkingIndicator();
        setTimeout(() => pinChrome(ctx, "session_settle"), 0);
        setTimeout(() => pinChrome(ctx, "session_settle"), 50);
        if (!stealTimer) {
            stealTimer = setInterval(() => hideForeignChrome(ctx, "interval"), 200);
        }
        if (process.env.HERDR_ENV === "1") {
            await probe(ctx);
        }
    });
    pi.on("turn_end", (_event, ctx) => {
        pinChrome(ctx, "turn_end");
    });
    pi.on("tool_execution_end", (_event, ctx) => {
        pinChrome(ctx, "tool_execution_end");
    });
    pi.on("session_shutdown", async () => {
        stopTimers();
        stopWorkingStatus();
        stopLiveWatch();
        generation += 1;
        siblings = undefined;
    });
}
