import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createListeners } from "./listeners.js";
export function createRexState() {
    return { layout: { tabs: new Map(), blocks: new Map() }, status: new Map() };
}
const TERMINAL_CREATOR = "com.superlogical.terminal";
/** Parses `rex window ls -s SESSION --json`. */
export function parseWindowList(stdout) {
    const data = JSON.parse(stdout);
    if (!Array.isArray(data.windows))
        throw new Error("invalid rex window list");
    const layout = { tabs: new Map(), blocks: new Map() };
    for (const window of data.windows) {
        const windowId = typeof window.window_id === "string" ? window.window_id : undefined;
        if (!windowId)
            continue;
        layout.tabs.set(windowId, typeof window.label === "string" ? window.label : "");
        for (const layer of window.layers ?? []) {
            for (const block of layer.blocks ?? []) {
                if (typeof block.block_id !== "string")
                    continue;
                if (block.creator_name !== undefined && block.creator_name !== TERMINAL_CREATOR)
                    continue;
                layout.blocks.set(block.block_id, windowId);
            }
        }
    }
    return layout;
}
/** Parses `rex block call -b BLOCK program_status`; returns the root record, if any. */
export function parseProgramStatus(stdout) {
    const data = JSON.parse(stdout);
    if (!Array.isArray(data.records))
        throw new Error("invalid rex program status");
    const root = data.records.find((record) => record.id === undefined || record.id === "");
    return root ? toRecord(root) : undefined;
}
function toRecord(raw) {
    if (typeof raw.state !== "string")
        return undefined;
    const record = { state: raw.state };
    const app = typeof raw.effective_app === "string" ? raw.effective_app : typeof raw.app === "string" ? raw.app : undefined;
    if (app)
        record.app = app;
    if (typeof raw.msg === "string")
        record.msg = raw.msg;
    return record;
}
/**
 * Applies one line of `rex events --json` to the state. Returns what changed: `status` (a pane's
 * record) or `layout` (the caller should re-read the window list). Unknown events are ignored.
 */
export function applyRexEvent(state, line) {
    // Shape: {"type":"session_event","payload":{"session_id":…,"event":{"type":…,"payload":{…}}}}
    let outer;
    try {
        outer = JSON.parse(line);
    }
    catch {
        return undefined;
    }
    if (outer.type !== "session_event")
        return undefined;
    const event = outer.payload?.event;
    const payload = event?.payload ?? {};
    switch (event?.type) {
        case "block_event": {
            const blockId = payload.block_id;
            if (typeof blockId !== "string")
                return undefined;
            const inner = (payload.payload ?? {});
            if (payload.name === "program_status_changed") {
                if (inner.id !== "" && inner.id !== undefined)
                    return undefined;
                const record = toRecord((inner.record ?? {}));
                if (!record)
                    return undefined;
                state.status.set(blockId, record);
                return "status";
            }
            if (payload.name === "program_status_removed") {
                const ids = Array.isArray(inner.ids) ? inner.ids : [];
                if (!ids.includes(""))
                    return undefined;
                return state.status.delete(blockId) ? "status" : undefined;
            }
            return undefined;
        }
        case "block_closed": {
            const blockId = payload.block_id;
            if (typeof blockId !== "string")
                return undefined;
            state.status.delete(blockId);
            state.layout.blocks.delete(blockId);
            return "layout";
        }
        case "block_created":
        case "window_label_changed":
        case "window_created":
        case "window_closed":
        case "session_label_changed":
            return "layout";
        default:
            return undefined;
    }
}
/** A Rex auto-label such as `Window 395a96cb` says nothing about the work; prefer the program. */
const AUTO_LABEL = /^Window [0-9a-f]+$/i;
/**
 * Siblings are named after their tab, like Herdr siblings. A pane in the same tab as this pi
 * would share our tab's name, so it is named after its program instead.
 */
export function listRexSiblings(state, selfBlock) {
    if (!selfBlock)
        return undefined;
    const selfWindow = state.layout.blocks.get(selfBlock);
    const parts = [];
    for (const [blockId, record] of state.status) {
        if (blockId === selfBlock)
            continue;
        const windowId = state.layout.blocks.get(blockId);
        const label = windowId && windowId !== selfWindow ? state.layout.tabs.get(windowId) : undefined;
        const name = label && !AUTO_LABEL.test(label) ? label : record.app;
        if (!name)
            continue;
        parts.push({ name, status: record.state });
    }
    if (parts.length === 0)
        return undefined;
    return parts;
}
const REX_EXEC_TIMEOUT_MS = 3000;
const REX_RESTART_MS = 10000;
const REX_LAYOUT_DEBOUNCE_MS = 150;
export function createRexSiblings(deps) {
    const env = deps.env ?? process.env;
    const spawn = deps.spawn ?? ((command, args) => nodeSpawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }));
    const session = env.REX_SESSION ?? "";
    const selfBlock = env.REX_BLOCK;
    let alive = true;
    let child;
    let restartTimer;
    let layoutTimer;
    let layoutInFlight = false;
    let layoutDirty = false;
    let siblings;
    const state = createRexState();
    const listeners = createListeners();
    const recompute = () => {
        if (!alive)
            return;
        const next = listRexSiblings(state, selfBlock);
        const changed = JSON.stringify(next) !== JSON.stringify(siblings);
        siblings = next;
        if (changed)
            listeners.notify();
    };
    const refreshLayout = async (seedStatus) => {
        if (!alive)
            return;
        if (layoutInFlight) {
            layoutDirty = true;
            return;
        }
        layoutInFlight = true;
        try {
            const run = await deps.pi.exec("rex", ["window", "ls", "-s", session, "--json"], { timeout: REX_EXEC_TIMEOUT_MS });
            if (!alive)
                return;
            if (run.code !== 0 || run.killed)
                return;
            const layout = parseWindowList(run.stdout);
            state.layout = layout;
            for (const blockId of [...state.status.keys()]) {
                if (!layout.blocks.has(blockId))
                    state.status.delete(blockId);
            }
            if (seedStatus) {
                await Promise.all([...layout.blocks.keys()]
                    .filter((blockId) => blockId !== selfBlock)
                    .map(async (blockId) => {
                    try {
                        const status = await deps.pi.exec("rex", ["block", "call", "-s", session, "-b", blockId, "program_status"], { timeout: REX_EXEC_TIMEOUT_MS });
                        if (!alive || status.code !== 0 || status.killed)
                            return;
                        const record = parseProgramStatus(status.stdout);
                        if (record)
                            state.status.set(blockId, record);
                        else
                            state.status.delete(blockId);
                    }
                    catch {
                        // A pane that vanished mid-seed shows up via events later.
                    }
                }));
            }
            recompute();
        }
        catch {
            // Keep the last known layout; the next layout event retries.
        }
        finally {
            layoutInFlight = false;
            if (layoutDirty && alive) {
                layoutDirty = false;
                void refreshLayout(false);
            }
        }
    };
    const scheduleLayoutRefresh = () => {
        if (!alive || layoutTimer)
            return;
        layoutTimer = setTimeout(() => {
            layoutTimer = undefined;
            void refreshLayout(false);
        }, REX_LAYOUT_DEBOUNCE_MS);
    };
    const start = () => {
        if (!alive)
            return;
        restartTimer = undefined;
        let proc;
        try {
            proc = spawn("rex", ["events", "-s", session, "--json"]);
        }
        catch {
            scheduleRestart();
            return;
        }
        child = proc;
        if (proc.stdout) {
            const lines = createInterface({ input: proc.stdout });
            lines.on("line", (line) => {
                if (!alive || child !== proc)
                    return;
                const effect = applyRexEvent(state, line);
                if (effect === "status")
                    recompute();
                else if (effect === "layout") {
                    recompute();
                    scheduleLayoutRefresh();
                }
            });
        }
        proc.on("error", () => { if (child === proc)
            onExit(); });
        proc.on("exit", () => { if (child === proc)
            onExit(); });
        void refreshLayout(true);
    };
    const onExit = () => {
        child = undefined;
        if (!alive)
            return;
        state.status.clear();
        recompute();
        scheduleRestart();
    };
    const scheduleRestart = () => {
        if (!alive || restartTimer)
            return;
        restartTimer = setTimeout(start, REX_RESTART_MS);
    };
    start();
    return {
        get: () => siblings,
        onChange: listeners.add,
        dispose() {
            if (!alive)
                return;
            alive = false;
            if (restartTimer)
                clearTimeout(restartTimer);
            if (layoutTimer)
                clearTimeout(layoutTimer);
            restartTimer = undefined;
            layoutTimer = undefined;
            const proc = child;
            child = undefined;
            try {
                proc?.kill();
            }
            catch { /* already gone */ }
            siblings = undefined;
            listeners.clear();
        },
    };
}
