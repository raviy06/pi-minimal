export function rowIsRunning(context) {
    if (context.isError)
        return false;
    if (context.state?.done)
        return false;
    if (context.isPartial === false)
        return false;
    return true;
}
export function activityBullet(running, frame) {
    return running && frame === 1 ? "◇" : "◆";
}
