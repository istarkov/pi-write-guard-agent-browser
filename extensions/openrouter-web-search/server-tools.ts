// Pure helpers for injecting OpenRouter's server-side tools into request bodies.
//
// Docs:
// - https://openrouter.ai/docs/guides/features/server-tools/web-search
// - https://openrouter.ai/docs/guides/features/server-tools/datetime

export type ServerTool =
	| { type: "openrouter:web_search" }
	| { type: "openrouter:datetime"; parameters?: { timezone: string } };

export type ModelLike = { provider?: string; baseUrl?: string };

export type EnvLike = Record<string, string | undefined>;

export function isOpenRouter(model: ModelLike | undefined): boolean {
	if (!model) return false;
	return model.provider === "openrouter" || (model.baseUrl ?? "").includes("openrouter.ai");
}

export function serverTools(env: EnvLike): ServerTool[] {
	const tools: ServerTool[] = [];
	if (env.PI_OPENROUTER_WEB_SEARCH !== "0") {
		tools.push({ type: "openrouter:web_search" });
	}
	if (env.PI_OPENROUTER_DATETIME !== "0") {
		const timezone = env.PI_OPENROUTER_DATETIME_TIMEZONE?.trim();
		tools.push(
			timezone
				? { type: "openrouter:datetime", parameters: { timezone } }
				: { type: "openrouter:datetime" },
		);
	}
	return tools;
}

// Adds any missing server tools to `body.tools`. Mutates and returns `body` when
// something was added; returns `undefined` when the body was left untouched.
export function applyServerTools(
	body: unknown,
	model: ModelLike | undefined,
	env: EnvLike,
): unknown {
	if (!isOpenRouter(model)) return undefined;
	if (!body || typeof body !== "object") return undefined;

	const tools = (body as { tools?: unknown }).tools;
	// Only touch requests that already declare tools, so summarization and other
	// tool-less calls stay untouched.
	if (!Array.isArray(tools)) return undefined;

	const existing = new Set(
		tools
			.filter((tool): tool is { type: string } => !!tool && typeof tool === "object")
			.map((tool) => (tool as { type?: unknown }).type)
			.filter((type): type is string => typeof type === "string"),
	);

	const missing = serverTools(env).filter((tool) => !existing.has(tool.type));
	if (missing.length === 0) return undefined;

	(body as { tools: unknown[] }).tools = [...tools, ...missing];
	return body;
}
