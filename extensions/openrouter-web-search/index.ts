// Inject OpenRouter's server-side web search tool into outgoing requests.
//
// OpenRouter runs `openrouter:web_search` on its side, so the model can search
// the web on demand (0-N times per request) without any client-side tool code.
// Docs: https://openrouter.ai/docs/guides/features/server-tools/web-search
//
// Disable with PI_OPENROUTER_WEB_SEARCH=0.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SERVER_TOOL = { type: "openrouter:web_search" } as const;

function isOpenRouter(model: { provider?: string; baseUrl?: string } | undefined): boolean {
	if (!model) return false;
	return model.provider === "openrouter" || (model.baseUrl ?? "").includes("openrouter.ai");
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		if (process.env.PI_OPENROUTER_WEB_SEARCH === "0") return;
		if (!isOpenRouter(ctx.model)) return;

		const body = event.payload;
		if (!body || typeof body !== "object") return;

		// Only touch requests that already declare tools, so summarization and
		// other tool-less calls stay untouched.
		const tools = (body as { tools?: unknown }).tools;
		if (!Array.isArray(tools)) return;

		const already = tools.some(
			(t) => t && typeof t === "object" && (t as { type?: string }).type === SERVER_TOOL.type,
		);
		if (already) return;

		(body as { tools: unknown[] }).tools = [...tools, SERVER_TOOL];
		return body;
	});
}
