/**
 * Horizontal margin for pi-minimal's chrome (status line, footer, turn rule, tool rows).
 * Follows pi's `outputPad` setting so chrome lines up with transcript text. Pi's editor uses
 * the separate `editorPaddingX` setting (default 0); set it to the same value for a flush
 * left edge.
 */
const KEY = Symbol.for("pi-minimal.chrome-margin")
const store = globalThis as unknown as Record<symbol, number | undefined>

/** Kept for modules linked against an older copy of this file across a hot reload. */
export const CHROME_MARGIN = 1

export function chromeMargin(): number {
  return store[KEY] ?? CHROME_MARGIN
}

export function setChromeMargin(value: number): void {
  store[KEY] = value === 0 ? 0 : 1
}
