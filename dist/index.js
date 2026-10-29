import { showBackgroundOverlay } from "./background-overlay.js";
import { installCodeBox } from "./code-box.js";
import { createSession } from "./session.js";
import { installToolRenderers, stopLiveWatch } from "./tools.js";
import { installTranscript } from "./transcript.js";
import { installTurnRule } from "./turn-rule.js";
import { installWorkingStatus } from "./working-status.js";
/**
 * Process-wide hooks are installed once at load (renderers, transformers, the code-box patch);
 * everything else lives on a `Session` created at session_start and disposed at session_shutdown
 * or when the next session starts.
 */
export default function piMinimalExtension(pi) {
    const stopWorkingStatus = installWorkingStatus(pi);
    const stopTurnRule = installTurnRule(pi);
    installToolRenderers(pi);
    installTranscript(pi);
    installCodeBox();
    let active;
    let busy = false;
    // Background processes: `/bg` and a shortcut (default ctrl+b, see `backgroundShortcut`). The
    // shortcut is registered once per key at load, since pi has no unregister; it reads the active
    // session's config when pressed.
    const openBackground = async (ctx) => {
        if (!active?.background)
            return;
        await showBackgroundOverlay(ctx, active.background, active.backgroundShortcut ?? undefined);
    };
    pi.registerCommand("bg", { description: "Show processes left running by bash tool calls", handler: (_args, ctx) => openBackground(ctx) });
    const registeredShortcuts = new Set();
    const ensureShortcut = () => {
        const key = active?.backgroundShortcut;
        if (!key || registeredShortcuts.has(key) || typeof pi.registerShortcut !== "function")
            return;
        registeredShortcuts.add(key);
        pi.registerShortcut(key, {
            description: "Show background processes",
            handler: (ctx) => (active?.backgroundShortcut === key ? openBackground(ctx) : undefined),
        });
    };
    pi.on("session_start", (_event, ctx) => {
        active?.dispose();
        active = createSession(pi, ctx, { busy: () => busy });
        ensureShortcut();
    });
    pi.on("tool_execution_start", (event) => {
        active?.background?.toolStart(event.toolCallId, event.toolName);
    });
    pi.on("agent_start", () => {
        busy = true;
    });
    pi.on("agent_end", () => {
        busy = false;
        active?.refreshGit();
    });
    pi.on("turn_end", () => {
        active?.pin("turn_end");
        active?.refreshGit();
    });
    pi.on("tool_execution_end", (event) => {
        active?.background?.toolEnd(event.toolCallId, event.toolName);
        active?.pin("tool_execution_end");
        active?.refreshGit();
    });
    pi.on("session_shutdown", () => {
        active?.dispose();
        active = undefined;
        busy = false;
        stopWorkingStatus();
        stopTurnRule();
        stopLiveWatch();
    });
}
