import { Text } from "@earendil-works/pi-tui"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"

export function installHeader(ctx: ExtensionContext): void {
  ctx.ui.setHeader(() => {
    const text = new Text("", 0, 0)
    return {
      render(): string[] {
        return text.render(1)
      },
      invalidate() {
        text.invalidate()
      },
    }
  })
}
