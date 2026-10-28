import { createListeners } from "./listeners.js";
function parseJson(stdout) {
    return JSON.parse(stdout);
}
export function parseAgentList(stdout) {
    const data = parseJson(stdout);
    const rows = data.result?.agents;
    if (!Array.isArray(rows))
        throw new Error("invalid herdr agent list");
    return rows.map((row) => ({
        agent: String(row.agent ?? ""),
        agent_status: String(row.agent_status ?? ""),
        pane_id: String(row.pane_id ?? ""),
        tab_id: String(row.tab_id ?? ""),
    }));
}
export function parseTabList(stdout) {
    const data = parseJson(stdout);
    const rows = data.result?.tabs;
    if (!Array.isArray(rows))
        throw new Error("invalid herdr tab list");
    return rows.map((row) => ({
        label: String(row.label ?? ""),
        tab_id: String(row.tab_id ?? ""),
    }));
}
export function listSiblings(agents, tabs, selfPane, selfTab) {
    if (!selfPane && !selfTab)
        return undefined;
    const labels = new Map(tabs.map((t) => [t.tab_id, t.label]));
    const parts = [];
    for (const agent of agents) {
        if (selfPane && agent.pane_id === selfPane)
            continue;
        if (!selfPane && selfTab && agent.tab_id === selfTab)
            continue;
        const name = labels.get(agent.tab_id) || agent.agent;
        if (!name)
            continue;
        parts.push({ name, status: agent.agent_status });
    }
    if (parts.length === 0)
        return undefined;
    return parts;
}
const HERDR_FAST_MS = 2000;
const HERDR_SLOW_MS = 10000;
const HERDR_EXEC_TIMEOUT_MS = 3000;
/**
 * Polls `herdr agent list` + `herdr tab list`: every 2 s while siblings are visible, every 10 s
 * otherwise or after a failure. Probes once immediately.
 */
export function createHerdrSiblings(pi, env = process.env) {
    let alive = true;
    let siblings;
    let timer;
    let period = 0;
    let inFlight;
    const listeners = createListeners();
    const set = (next) => {
        const changed = JSON.stringify(next) !== JSON.stringify(siblings);
        siblings = next;
        if (changed)
            listeners.notify();
    };
    const schedule = (periodMs) => {
        if (!alive || period === periodMs)
            return;
        if (timer)
            clearInterval(timer);
        period = periodMs;
        timer = setInterval(() => { void probe(); }, periodMs);
    };
    const probe = async () => {
        if (!alive || inFlight)
            return;
        const ac = new AbortController();
        inFlight = ac;
        try {
            const agentRun = await pi.exec("herdr", ["agent", "list"], { timeout: HERDR_EXEC_TIMEOUT_MS, signal: ac.signal });
            if (!alive)
                return;
            const tabRun = await pi.exec("herdr", ["tab", "list"], { timeout: HERDR_EXEC_TIMEOUT_MS, signal: ac.signal });
            if (!alive)
                return;
            if (agentRun.code !== 0 || tabRun.code !== 0 || agentRun.killed || tabRun.killed) {
                set(undefined);
                schedule(HERDR_SLOW_MS);
                return;
            }
            set(listSiblings(parseAgentList(agentRun.stdout), parseTabList(tabRun.stdout), env.HERDR_PANE_ID, env.HERDR_TAB_ID));
            schedule(siblings ? HERDR_FAST_MS : HERDR_SLOW_MS);
        }
        catch {
            if (!alive)
                return;
            set(undefined);
            schedule(HERDR_SLOW_MS);
        }
        finally {
            if (inFlight === ac)
                inFlight = undefined;
        }
    };
    void probe();
    return {
        get: () => siblings,
        onChange: listeners.add,
        dispose() {
            if (!alive)
                return;
            alive = false;
            if (timer)
                clearInterval(timer);
            timer = undefined;
            inFlight?.abort();
            inFlight = undefined;
            siblings = undefined;
            listeners.clear();
        },
    };
}
