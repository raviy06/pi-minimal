import { createHerdrSiblings } from "./herdr.js";
import { createRexSiblings } from "./rex.js";
/**
 * Picks the host the session runs in. Herdr wins when both are present (Rex inside a Herdr pane):
 * Herdr knows every agent it launched, Rex only the programs that report status.
 */
export function createSiblingSource(deps) {
    const env = deps.env ?? process.env;
    if (env.HERDR_ENV === "1")
        return createHerdrSiblings(deps.pi, env);
    if (env.REX_SESSION && env.REX_BLOCK)
        return createRexSiblings({ pi: deps.pi, env, spawn: deps.spawn });
    return undefined;
}
