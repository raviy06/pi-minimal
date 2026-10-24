import { stripVTControlCharacters } from "node:util";
export const ACTIVITY_STATES = ["queued", "running", "waiting", "paused", "stopping", "completed", "failed", "stopped", "unknown"];
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identity(value) {
    return typeof value === "string" && /^[a-zA-Z0-9._:@+-]{1,128}$/.test(value);
}
export function cleanActivityText(value) {
    return stripVTControlCharacters(value)
        // Also remove bare C0/C1 and bidi controls; no terminal commands from labels.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
        .replace(/\s+/gu, " ").trim();
}
function normalizeSnapshot(input) {
    if (!record(input) || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
        !Number.isSafeInteger(input.omitted) || input.omitted < 0 ||
        !["spinner", "static"].includes(input.motion) || !["icons", "plain"].includes(input.format) ||
        !Array.isArray(input.rows) || input.rows.length > 64)
        return;
    const rows = [];
    const parents = new Map();
    for (const item of input.rows) {
        if (!record(item) || !identity(item.key) || parents.has(item.key) ||
            typeof item.agent !== "string" || item.agent.length > 96 || !cleanActivityText(item.agent) ||
            typeof item.text !== "string" || item.text.length > 256 ||
            !ACTIVITY_STATES.includes(item.state) ||
            (item.parentKey !== undefined && !identity(item.parentKey)))
            return;
        parents.set(item.key, item.parentKey);
        rows.push(Object.freeze({ key: item.key, agent: cleanActivityText(item.agent), state: item.state,
            text: cleanActivityText(item.text), ...(item.parentKey === undefined ? {} : { parentKey: item.parentKey }) }));
    }
    for (const row of rows) {
        const seen = new Set([row.key]);
        let parent = row.parentKey;
        while (parent !== undefined) {
            if (!parents.has(parent) || seen.has(parent))
                return;
            seen.add(parent);
            parent = parents.get(parent);
        }
    }
    return Object.freeze({ revision: input.revision, rows: Object.freeze(rows), omitted: input.omitted,
        motion: input.motion, format: input.format });
}
export function createFooterContributions(initialSessionId = null) {
    let sessionId = initialSessionId;
    let owner;
    let snapshot;
    const observers = new Set();
    const notify = () => {
        for (const observer of [...observers]) {
            try {
                observer();
            }
            catch { /* A disposed UI must not invalidate a successful publish. */ }
        }
    };
    return {
        read: () => snapshot,
        subscribe(observer) { observers.add(observer); return () => { observers.delete(observer); }; },
        reset(nextSessionId) {
            sessionId = nextSessionId;
            owner = undefined;
            snapshot = undefined;
            notify();
        },
        register(input) {
            if (!record(input) || !identity(input.owner) || typeof input.sessionId !== "string" || !input.sessionId)
                return { ok: false, code: "invalid" };
            if (sessionId === null || input.sessionId !== sessionId)
                return { ok: false, code: "wrong-session" };
            if (owner)
                return { ok: false, code: "occupied" };
            const token = Symbol(input.owner);
            owner = token;
            return { ok: true, registration: {
                    publish(input) {
                        if (owner !== token)
                            return { ok: false, code: "disposed" };
                        const next = normalizeSnapshot(input);
                        if (!next)
                            return { ok: false, code: "invalid" };
                        if (snapshot && next.revision <= snapshot.revision)
                            return { ok: false, code: "stale" };
                        snapshot = next;
                        notify();
                        return { ok: true };
                    },
                    dispose() {
                        if (owner !== token)
                            return;
                        owner = undefined;
                        snapshot = undefined;
                        notify();
                    },
                } };
        },
    };
}
