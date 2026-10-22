/**
 * Horizontal margin for pi-minimal's chrome (status line, footer, turn rule, tool rows).
 * Follows pi's `outputPad` setting so chrome lines up with transcript text. Pi's editor uses
 * the separate `editorPaddingX` setting (default 0); set it to the same value for a flush
 * left edge.
 */
let margin = 1;
export function chromeMargin() {
    return margin;
}
export function setChromeMargin(value) {
    margin = value === 0 ? 0 : 1;
}
