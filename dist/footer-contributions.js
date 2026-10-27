import { stripVTControlCharacters } from "node:util";
import { normalizePlanSnapshot } from "./footer-plan.js";
export const ACTIVITY_STATES = ["queued", "running", "waiting", "paused", "stopping", "completed", "failed", "stopped", "unknown"];
export const TASK_STATUSES = ["todo", "in_progress", "blocked", "in_review", "done", "cancelled"];
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
function validMetrics(value) {
    return record(value) && [value.elapsedMs, value.tokens].every(n => n === undefined || (Number.isSafeInteger(n) && n >= 0));
}
function validTask(value) {
    return record(value) && identity(value.planId) && identity(value.id) && TASK_STATUSES.includes(value.status);
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
            (item.parentKey !== undefined && !identity(item.parentKey)) ||
            (item.metrics !== undefined && !validMetrics(item.metrics)) ||
            (item.task !== undefined && !validTask(item.task)))
            return;
        parents.set(item.key, item.parentKey);
        rows.push(Object.freeze({ key: item.key, agent: cleanActivityText(item.agent), state: item.state,
            text: cleanActivityText(item.text), ...(item.parentKey === undefined ? {} : { parentKey: item.parentKey }),
            ...(item.metrics === undefined ? {} : { metrics: Object.freeze({ elapsedMs: item.metrics.elapsedMs, tokens: item.metrics.tokens }) }),
            ...(item.task === undefined ? {} : { task: Object.freeze({ planId: item.task.planId, id: item.task.id, status: item.task.status }) }),
        }));
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
function createFooterSlot(normalize, initialSessionId) {
    let sessionId = initialSessionId;
    // The registrant's `owner` string is a display identity; this symbol is the actual authority to publish.
    let ownerToken;
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
            ownerToken = undefined;
            snapshot = undefined;
            notify();
        },
        register(input) {
            if (!record(input) || !identity(input.owner) || typeof input.sessionId !== "string" || !input.sessionId)
                return { ok: false, code: "invalid" };
            if (sessionId === null || input.sessionId !== sessionId)
                return { ok: false, code: "wrong-session" };
            if (ownerToken)
                return { ok: false, code: "occupied" };
            const token = Symbol(input.owner);
            ownerToken = token;
            return { ok: true, registration: {
                    publish(input) {
                        if (ownerToken !== token)
                            return { ok: false, code: "disposed" };
                        const next = normalize(input);
                        if (!next)
                            return { ok: false, code: "invalid" };
                        if (snapshot && next.revision <= snapshot.revision)
                            return { ok: false, code: "stale" };
                        snapshot = next;
                        notify();
                        return { ok: true };
                    },
                    dispose() {
                        if (ownerToken !== token)
                            return;
                        ownerToken = undefined;
                        snapshot = undefined;
                        notify();
                    },
                } };
        },
    };
}
export function createFooterContributions(initialSessionId = null) {
    const activity = createFooterSlot(normalizeSnapshot, initialSessionId);
    // The plan slot; "summary" is its legacy wire name.
    const plan = createFooterSlot(normalizePlanSnapshot, initialSessionId);
    return {
        read: activity.read,
        readPlan: plan.read,
        register: activity.register,
        registerPlan: plan.register,
        subscribe(observer) {
            const offActivity = activity.subscribe(observer), offPlan = plan.subscribe(observer);
            return () => { offActivity(); offPlan(); };
        },
        reset(sessionId) { activity.reset(sessionId); plan.reset(sessionId); },
    };
}
