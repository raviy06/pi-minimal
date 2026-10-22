import { Markdown, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui"

/**
 * pi-tui renders fenced code as literal ``` lines. Pi exposes no hook for the code token, so
 * pi-minimal post-processes the rendered lines of every `code` token into a closed box:
 *
 *   ╭─ json ──────────────╮
 *   │ { "a": 1 }          │
 *   ╰─────────────────────╯
 *
 * Code lines longer than the box are wrapped inside it so the right edge stays intact.
 */

type CodeToken = { type?: string; lang?: string; text?: string }
type MarkdownThemeLike = {
  codeBlockBorder: (text: string) => string
  codeBlockIndent?: string
}

const PATCHED = Symbol.for("pi-minimal.code-box")
/** Current framing implementation. Lives on globalThis so a /reload swaps the behaviour of the
 *  wrapper that an earlier load already installed on pi-tui's shared Markdown prototype. */
const FRAME_SLOT = Symbol.for("pi-minimal.code-box.frame")

type Framer = (lines: string[], lang: string | undefined, width: number, theme: MarkdownThemeLike) => string[]
const slots = globalThis as unknown as Record<symbol, Framer | undefined>

export function frameCodeLines(lines: string[], lang: string | undefined, width: number, theme: MarkdownThemeLike): string[] {
  if (lines.length < 2) return lines
  // Trailing spacer ("" after the closing fence) is preserved as-is.
  let end = lines.length
  while (end > 0 && lines[end - 1] === "") end -= 1
  if (end < 2) return lines
  const trailer = lines.slice(end)
  const body = lines.slice(1, end - 1)
  const indent = theme.codeBlockIndent ?? "  "
  const outer = Math.max(6, width)
  // "│ " + content + " │"
  const innerWidth = outer - 4

  const label = lang ? ` ${lang} ` : ""
  const topRule = "─".repeat(Math.max(1, outer - 3 - visibleWidth(label)))
  const top = theme.codeBlockBorder(`╭─${label}${topRule}╮`)
  const bottom = theme.codeBlockBorder(`╰${"─".repeat(outer - 2)}╯`)
  const edge = theme.codeBlockBorder("│")

  const framed: string[] = []
  for (const line of body) {
    const content = line.startsWith(indent) ? line.slice(indent.length) : line
    for (const piece of wrapTextWithAnsi(content, innerWidth)) {
      const pad = Math.max(0, innerWidth - visibleWidth(piece))
      framed.push(`${edge} ${piece}${" ".repeat(pad)} ${edge}`)
    }
  }
  if (framed.length === 0) framed.push(`${edge} ${" ".repeat(innerWidth)} ${edge}`)
  return [top, ...framed, bottom, ...trailer]
}

type RenderToken = (this: { theme: MarkdownThemeLike }, token: CodeToken, width: number, next?: string, style?: unknown) => string[]

/**
 * Patch pi-tui's Markdown renderer. The prototype wrapper is installed once per process; every
 * call (including after /reload) points it at this module's `frameCodeLines`.
 * Returns false when the renderer is not patchable.
 */
export function installCodeBox(): boolean {
  slots[FRAME_SLOT] = frameCodeLines
  const proto = Markdown.prototype as unknown as Record<string | symbol, unknown>
  if (proto[PATCHED]) return true
  const original = proto.renderToken
  if (typeof original !== "function") return false
  const originalRender = original as RenderToken
  proto.renderToken = function (this: { theme: MarkdownThemeLike }, token: CodeToken, width: number, next?: string, style?: unknown) {
    const lines = originalRender.call(this, token, width, next, style)
    if (token?.type !== "code" || !this.theme?.codeBlockBorder) return lines
    const frame = slots[FRAME_SLOT]
    if (!frame) return lines
    try {
      return frame(lines, token.lang, width, this.theme)
    } catch {
      return lines
    }
  }
  proto[PATCHED] = true
  return true
}
