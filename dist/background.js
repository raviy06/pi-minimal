import { createListeners } from "./listeners.js";
export const PS_ARGS = ["-ax", "-o", "pid=,ppid=,pgid=,etime=,command="];
const ENDED_TTL_MS = 60_000;
const POLL_MS = 2000;
const PS_TIMEOUT_MS = 3000;
/** Parses `etime` (`SS`, `MM:SS`, `HH:MM:SS`, `DD-HH:MM:SS`) into seconds. */
export function parseEtime(text) {
    const [daysPart, clock] = text.includes("-") ? text.split("-", 2) : [undefined, text];
    const parts = (clock ?? "").split(":").map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => !Number.isFinite(part)))
        return 0;
    let seconds = 0;
    for (const part of parts)
        seconds = seconds * 60 + part;
    const days = daysPart === undefined ? 0 : Number.parseInt(daysPart, 10);
    return seconds + (Number.isFinite(days) ? days : 0) * 86400;
}
/** Parses `ps -ax -o pid=,ppid=,pgid=,etime=,command=` output. */
export function parsePs(stdout) {
    const entries = new Map();
    for (const line of stdout.split("\n")) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        if (!match)
            continue;
        const pid = Number(match[1]);
        entries.set(pid, {
            pid,
            ppid: Number(match[2]),
            pgid: Number(match[3]),
            elapsedSec: parseEtime(match[4] ?? ""),
            command: (match[5] ?? "").trim(),
        });
    }
    return entries;
}
/**
 * Process groups a finished tool call left behind: processes present only in `after`, orphaned
 * (ppid 1), whose group leader is a pid that did not exist in `before` and is gone in `after`.
 * Any group that was alive before the call, or whose leader still runs, belongs to someone else.
 */
export function findOrphanGroups(before, after) {
    const groupsBefore = new Set();
    for (const entry of before.values())
        groupsBefore.add(entry.pgid);
    const groups = new Set();
    for (const [pid, entry] of after) {
        if (before.has(pid) || entry.ppid !== 1)
            continue;
        if (groupsBefore.has(entry.pgid) || after.has(entry.pgid))
            continue;
        groups.add(entry.pgid);
    }
    return groups;
}
export function createBackgroundState() {
    return { groups: new Set(), processes: new Map() };
}
/**
 * Reconciles tracked processes with a fresh `ps` listing: records new members of tracked groups,
 * marks vanished ones ended, forgets ended ones after their TTL, and drops empty groups.
 * Returns whether anything changed.
 */
export function applyPoll(state, ps, now) {
    let changed = false;
    const seen = new Set();
    for (const entry of ps.values()) {
        if (!state.groups.has(entry.pgid) || entry.pid === entry.pgid)
            continue;
        seen.add(entry.pid);
        const known = state.processes.get(entry.pid);
        if (known && known.endedAt === undefined)
            continue;
        state.processes.set(entry.pid, {
            pid: entry.pid,
            pgid: entry.pgid,
            command: entry.command,
            startedAt: now - entry.elapsedSec * 1000,
        });
        changed = true;
    }
    for (const [pid, proc] of state.processes) {
        if (seen.has(pid))
            continue;
        if (proc.endedAt === undefined) {
            proc.endedAt = now;
            changed = true;
        }
        else if (now - proc.endedAt > ENDED_TTL_MS) {
            state.processes.delete(pid);
            changed = true;
        }
    }
    for (const pgid of state.groups) {
        const live = [...state.processes.values()].some((proc) => proc.pgid === pgid);
        if (!live) {
            state.groups.delete(pgid);
            changed = true;
        }
    }
    return changed;
}
export function snapshot(state) {
    const running = [];
    const ended = [];
    for (const proc of state.processes.values())
        (proc.endedAt === undefined ? running : ended).push(proc);
    running.sort((a, b) => a.startedAt - b.startedAt);
    ended.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    return { running, ended };
}
export function createBackgroundTracker(deps) {
    const now = deps.now ?? Date.now;
    const killProcess = deps.killProcess ?? ((pid, signal) => process.kill(pid, signal));
    const tools = new Set(deps.tools ?? ["bash", "powershell"]);
    const state = createBackgroundState();
    const listeners = createListeners();
    const starts = new Map();
    let alive = true;
    let timer;
    let polling = false;
    const listProcesses = async () => {
        try {
            const run = await deps.pi.exec("ps", PS_ARGS, { timeout: PS_TIMEOUT_MS });
            if (run.code !== 0 || run.killed)
                return undefined;
            return parsePs(run.stdout);
        }
        catch {
            return undefined;
        }
    };
    const schedule = () => {
        if (!alive || timer || state.groups.size === 0)
            return;
        timer = setTimeout(() => {
            timer = undefined;
            void poll();
        }, POLL_MS);
    };
    const poll = async () => {
        if (!alive || polling)
            return;
        polling = true;
        try {
            const ps = await listProcesses();
            if (!alive)
                return;
            if (ps && applyPoll(state, ps, now()))
                listeners.notify();
        }
        finally {
            polling = false;
            schedule();
        }
    };
    return {
        get: () => snapshot(state),
        onChange: listeners.add,
        toolStart(toolCallId, toolName) {
            if (!alive || !tools.has(toolName))
                return;
            starts.set(toolCallId, listProcesses());
        },
        toolEnd(toolCallId, toolName) {
            const before = starts.get(toolCallId);
            starts.delete(toolCallId);
            if (!alive || !before || !tools.has(toolName))
                return;
            void (async () => {
                const [beforePs, afterPs] = await Promise.all([before, listProcesses()]);
                if (!alive || !beforePs || !afterPs)
                    return;
                const groups = findOrphanGroups(beforePs, afterPs);
                if (groups.size === 0)
                    return;
                for (const pgid of groups)
                    state.groups.add(pgid);
                if (applyPoll(state, afterPs, now()))
                    listeners.notify();
                schedule();
            })();
        },
        kill(pid, options = {}) {
            const proc = state.processes.get(pid);
            if (!proc)
                return false;
            try {
                killProcess(options.group ? -proc.pgid : pid, options.signal ?? "SIGTERM");
                return true;
            }
            catch {
                return false;
            }
        },
        dispose() {
            if (!alive)
                return;
            alive = false;
            if (timer)
                clearTimeout(timer);
            timer = undefined;
            starts.clear();
            listeners.clear();
        },
    };
}
