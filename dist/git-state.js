export function parseBranch(stdout) {
    const line = stdout.trim().split("\n")[0]?.trim();
    if (!line || line === "HEAD")
        return undefined;
    return line;
}
export function parsePorcelain(stdout) {
    return stdout.split("\n").filter((line) => line.trim().length > 0).length;
}
export function formatGitState(state) {
    if (!state?.branch)
        return { branch: "", dirty: "" };
    const dirty = state.dirty && state.dirty > 0 ? `±${state.dirty}` : "";
    return { branch: state.branch, dirty };
}
/**
 * Polls git for the current branch and dirty count. Call `refresh()` after events that may have
 * changed the tree (tool results, turn end); `get()` is always synchronous.
 */
export function createGitState(pi, cwd, minIntervalMs = 5000) {
    let state;
    let lastRun = 0;
    let inFlight;
    let disposed = false;
    const listeners = new Set();
    const notify = () => {
        for (const listener of listeners) {
            try {
                listener();
            }
            catch {
                // One listener's failure must not starve the others.
            }
        }
    };
    const refresh = (force = false) => {
        if (disposed)
            return Promise.resolve();
        const now = Date.now();
        if (inFlight)
            return inFlight;
        if (!force && now - lastRun < minIntervalMs)
            return Promise.resolve();
        lastRun = now;
        // Read the directory once so both commands describe the same tree even if cwd changes mid-refresh.
        const dir = cwd();
        inFlight = (async () => {
            let next;
            try {
                const branchRun = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, timeout: 2000 });
                if (branchRun.code === 0) {
                    const branch = parseBranch(branchRun.stdout);
                    const statusRun = await pi.exec("git", ["status", "--porcelain"], { cwd: dir, timeout: 3000 });
                    next = { branch, dirty: statusRun.code === 0 ? parsePorcelain(statusRun.stdout) : undefined };
                }
            }
            catch {
                next = undefined;
            }
            finally {
                inFlight = undefined;
            }
            // A result that lands after dispose belongs to a session that no longer exists.
            if (disposed)
                return;
            state = next;
            notify();
        })();
        return inFlight;
    };
    return {
        get: () => state,
        refresh,
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        dispose() {
            disposed = true;
            listeners.clear();
        },
    };
}
