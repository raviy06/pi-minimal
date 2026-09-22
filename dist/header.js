import { Text } from "@earendil-works/pi-tui";
export function installHeader(ctx) {
    ctx.ui.setHeader(() => {
        const text = new Text("", 0, 0);
        return {
            render() {
                return text.render(1);
            },
            invalidate() {
                text.invalidate();
            },
        };
    });
}
