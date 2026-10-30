// Inject OpenRouter's server-side tools into outgoing requests.
//
// OpenRouter runs these tools on its side, so the model can use them on demand
// (0-N times per request) without any client-side tool code:
// - `openrouter:web_search` — web search
// - `openrouter:datetime` — current date/time (optional IANA timezone)
//
// Docs:
// - https://openrouter.ai/docs/guides/features/server-tools/web-search
// - https://openrouter.ai/docs/guides/features/server-tools/datetime
//
// ENV:
// - PI_OPENROUTER_WEB_SEARCH=0 — disable web search
// - PI_OPENROUTER_DATETIME=0 — disable datetime
// - PI_OPENROUTER_DATETIME_TIMEZONE=<IANA zone> — pass timezone to datetime
//   (default: UTC, tool sent without parameters)
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { applyServerTools } from "./server-tools.ts";

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		return applyServerTools(event.payload, ctx.model, process.env);
	});
}
