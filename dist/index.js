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
    pi.on("session_start", (_event, ctx) => {
        active?.dispose();
        active = createSession(pi, ctx, { busy: () => busy });
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
    pi.on("tool_execution_end", () => {
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
