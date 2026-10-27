export const FOOTER_EVENTS = {
    register: "pi-minimal:footer:v1:register",
    ready: "pi-minimal:footer:v1:ready",
    unavailable: "pi-minimal:footer:v1:unavailable",
};
/** Slot names on the wire. `summary` is the legacy name of the plan slot and stays accepted. */
export const FOOTER_SLOTS = ["activity", "plan", "summary"];
/** Bind once per session, not once per footer mount. Trusted in-process protocol. */
export function bindFooterContributionEvents(events, registry, sessionId, mode) {
    registry.reset(mode === "tui" ? sessionId : null);
    const unsubscribe = events.on(FOOTER_EVENTS.register, (value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value))
            return;
        const request = value;
        // A different host may have answered first. Never overwrite its result.
        if (request.result !== undefined)
            return;
        if (request.version !== 1 || !FOOTER_SLOTS.includes(request.slot))
            request.result = { ok: false, code: "invalid" };
        else if (mode !== "tui")
            request.result = { ok: false, code: "not-tui" };
        else
            request.result = request.slot === "activity" ? registry.register(request) : registry.registerPlan(request);
    });
    if (mode === "tui")
        events.emit(FOOTER_EVENTS.ready, { version: 1, sessionId, slots: [...FOOTER_SLOTS] });
    let disposed = false;
    return () => {
        if (disposed)
            return;
        disposed = true;
        unsubscribe();
        registry.reset(null);
        if (mode === "tui")
            events.emit(FOOTER_EVENTS.unavailable, { version: 1, sessionId });
    };
}
