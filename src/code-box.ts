import { Markdown, visibleWidth } from "@earendil-works/pi-tui"

/**
 * pi-tui renders fenced code as literal ``` lines. Pi exposes no hook for the code token, so
 * pi-minimal post-processes the rendered lines of every `code` token into a framed block:
 *
 *   ╭─ json ───────────────
 *   │ { "a": 1 }
 *   ╰──────────────────────
 *
 * The right edge is left open so long code lines wrap naturally instead of breaking the frame.
 */

type CodeToken = { type?: string; lang?: string; text?: string }
type MarkdownThemeLike = {
  codeBlockBorder: (text: string) => string
  codeBlockIndent?: string
}

const PATCHED = Symbol.for("pi-minimal.code-box")

export function frameCodeLines(lines: string[], lang: string | undefined, width: number, theme: MarkdownThemeLike): string[] {
  if (lines.length < 2) return lines
  // Trailing spacer ("" after the closing fence) is preserved as-is.
  let end = lines.length
  while (end > 0 && lines[end - 1] === "") end -= 1
  if (end < 2) return lines
  const trailer = lines.slice(end)
  const body = lines.slice(1, end - 1)
  const indent = theme.codeBlockIndent ?? "  "
  const inner = Math.max(4, width)

  // "╭─ lang ─────" : corner + lead dash + label + rule == inner
  const label = lang ? ` ${lang} ` : ""
  const topRule = "─".repeat(Math.max(1, inner - 2 - visibleWidth(label)))
  const top = theme.codeBlockBorder(`╭─${label}${topRule}`)
  const bottom = theme.codeBlockBorder(`╰${"─".repeat(Math.max(1, inner - 1))}`)
  const edge = theme.codeBlockBorder("│")

  const framed = body.map((line) => {
    const content = line.startsWith(indent) ? line.slice(indent.length) : line
    return `${edge} ${content}`
  })
  if (framed.length === 0) framed.push(edge)
  return [top, ...framed, bottom, ...trailer]
}

type RenderToken = (this: { theme: MarkdownThemeLike }, token: CodeToken, width: number, next?: string, style?: unknown) => string[]

/** Patch pi-tui's Markdown renderer once per process. Returns false when the renderer is not patchable. */
export function installCodeBox(): boolean {
  const proto = Markdown.prototype as unknown as Record<string | symbol, unknown>
  if (proto[PATCHED]) return true
  const original = proto.renderToken
  if (typeof original !== "function") return false
  const originalRender = original as RenderToken
  proto.renderToken = function (this: { theme: MarkdownThemeLike }, token: CodeToken, width: number, next?: string, style?: unknown) {
    const lines = originalRender.call(this, token, width, next, style)
    if (token?.type !== "code" || !this.theme?.codeBlockBorder) return lines
    try {
      return frameCodeLines(lines, token.lang, width, this.theme)
    } catch {
      return lines
    }
  }
  proto[PATCHED] = true
  return true
}
