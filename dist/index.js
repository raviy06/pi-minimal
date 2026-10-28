import { Type } from "@earendil-works/pi-ai";
import { showBackgroundOverlay } from "./background-overlay.js";
import { installCodeBox } from "./code-box.js";
import { isPrCreateCommand } from "./prs.js";
import { parsePrFilter, prsToolResult, runPrsCommand } from "./prs-command.js";
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
    // Open PRs for the repo in cwd: `/prs [mine|review|all]` and the `list_open_prs` tool.
    pi.registerCommand("prs", {
        description: "Open PRs in this repo that I authored or that need my review",
        handler: (args, ctx) => runPrsCommand(args, ctx, pi, active?.prs),
    });
    pi.registerTool({
        name: "list_open_prs",
        label: "List Open PRs",
        description: "List open pull requests in the current repository that the user authored or has been asked to review (via the gh CLI).",
        parameters: Type.Object({
            filter: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("mine"), Type.Literal("review")], { description: "all (default), mine, or review (waiting on my review)" })),
        }),
        async execute(_toolCallId, params) {
            await active?.prs?.refresh();
            const result = prsToolResult(active?.prs, params.filter ?? parsePrFilter(""));
            const text = result.prs.length === 0
                ? `No open PRs${result.repo ? ` in ${result.repo}` : ""}${result.error ? ` (${result.error})` : ""}.`
                : result.prs.map((pr) => `#${pr.number} [${pr.kind}${pr.isDraft ? ", draft" : ""}${pr.ciFailing ? ", CI failing" : ""}] ${pr.title} — ${pr.url}`).join("\n");
            return { content: [{ type: "text", text }], details: result };
        },
    });
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
    // Commands that create a PR: remember the URL they print so the chips follow the session
    // even when cwd is another repo (worktrees) or no repo at all.
    const prCreateCalls = new Map();
    pi.on("tool_execution_start", (event) => {
        active?.background?.toolStart(event.toolCallId, event.toolName);
        const command = event.args?.command;
        if ((event.toolName === "bash" || event.toolName === "powershell") && typeof command === "string" && isPrCreateCommand(command)) {
            prCreateCalls.set(event.toolCallId, true);
        }
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
        if (prCreateCalls.delete(event.toolCallId) && !event.isError) {
            const content = event.result?.content ?? [];
            active?.notePrUrls(content.map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : "")).join("\n"));
        }
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
