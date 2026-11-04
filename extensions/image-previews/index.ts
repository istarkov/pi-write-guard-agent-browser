import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installPreviewPatch } from "./patch.ts";

export default function imagePreviews(pi: ExtensionAPI) {
	if (process.env.PI_IMAGE_PREVIEWS === "0") return;
	let dispose: (() => void) | undefined;
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		// An empty widget supplies the host TUI without replacing the user's editor/footer.
		ctx.ui.setWidget("image-previews", (tui) => {
			dispose?.();
			dispose = installPreviewPatch({ requestRender: () => { tui.invalidate(); tui.requestRender(); }, rows: () => tui.terminal.rows });
			return { render: () => [], invalidate: () => {} };
		});
	});
	pi.on("session_shutdown", () => { dispose?.(); dispose = undefined; });
}
