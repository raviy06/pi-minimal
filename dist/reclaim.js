export function reclaimPolicy(reason) {
    if (reason === "session_start") {
        return { resetEditor: true, reinstallChrome: true };
    }
    if (reason === "interval") {
        return { resetEditor: false, reinstallChrome: false };
    }
    // session_settle / turn_end / tool_execution_end: restore chrome, keep editor
    return { resetEditor: false, reinstallChrome: true };
}
export function applyReclaim(reason, ui, install) {
    const policy = reclaimPolicy(reason);
    install.widgets();
    if (policy.resetEditor)
        ui.setEditorComponent(undefined);
    if (policy.reinstallChrome)
        install.chrome();
    return policy;
}
