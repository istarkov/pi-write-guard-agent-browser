import assert from "node:assert/strict";
import { test } from "node:test";

import {
	applyServerTools,
	isOpenRouter,
	serverTools,
} from "../extensions/openrouter-web-search/server-tools.ts";

const openrouter = { provider: "openrouter" };
const env = {};

function toolsOf(body: unknown): { type?: string; parameters?: unknown }[] {
	return (body as { tools: { type?: string; parameters?: unknown }[] }).tools;
}

test("datetime is added by default alongside web search", () => {
	const body = { tools: [{ type: "function", function: { name: "read" } }] };
	const result = applyServerTools(body, openrouter, env);
	assert.equal(result, body);
	assert.deepEqual(toolsOf(body).map((tool) => tool.type), [
		"function",
		"openrouter:web_search",
		"openrouter:datetime",
	]);
	assert.equal(toolsOf(body)[2].parameters, undefined);
});

test("timezone is passed in datetime parameters", () => {
	const body = { tools: [] };
	applyServerTools(body, openrouter, { PI_OPENROUTER_DATETIME_TIMEZONE: "America/New_York" });
	const datetime = toolsOf(body).find((tool) => tool.type === "openrouter:datetime");
	assert.deepEqual(datetime?.parameters, { timezone: "America/New_York" });
});

test("blank timezone is treated as unset and trimmed otherwise", () => {
	for (const blank of ["", "   ", "\t\n"]) {
		const body = { tools: [] };
		applyServerTools(body, openrouter, { PI_OPENROUTER_DATETIME_TIMEZONE: blank });
		const datetime = toolsOf(body).find((tool) => tool.type === "openrouter:datetime");
		assert.equal(datetime?.parameters, undefined);
	}

	const body = { tools: [] };
	applyServerTools(body, openrouter, { PI_OPENROUTER_DATETIME_TIMEZONE: "  Europe/Berlin  " });
	const datetime = toolsOf(body).find((tool) => tool.type === "openrouter:datetime");
	assert.deepEqual(datetime?.parameters, { timezone: "Europe/Berlin" });
});

test("repeated calls do not duplicate tools, but add missing types", () => {
	const body = { tools: [{ type: "openrouter:datetime" }] };
	applyServerTools(body, openrouter, env);
	assert.deepEqual(toolsOf(body).map((tool) => tool.type), [
		"openrouter:datetime",
		"openrouter:web_search",
	]);

	// Nothing missing now: payload is left untouched.
	const again = applyServerTools(body, openrouter, env);
	assert.equal(again, undefined);
	assert.deepEqual(toolsOf(body).map((tool) => tool.type), [
		"openrouter:datetime",
		"openrouter:web_search",
	]);
});

test("ENV=0 disables each tool independently", () => {
	assert.deepEqual(
		serverTools({ PI_OPENROUTER_WEB_SEARCH: "0" }).map((tool) => tool.type),
		["openrouter:datetime"],
	);
	assert.deepEqual(
		serverTools({ PI_OPENROUTER_DATETIME: "0" }).map((tool) => tool.type),
		["openrouter:web_search"],
	);

	const body = { tools: [] };
	const result = applyServerTools(body, openrouter, {
		PI_OPENROUTER_WEB_SEARCH: "0",
		PI_OPENROUTER_DATETIME: "0",
	});
	assert.equal(result, undefined);
	assert.deepEqual(body.tools, []);
});

test("non-OpenRouter models are untouched", () => {
	const body = { tools: [] };
	assert.equal(isOpenRouter({ provider: "anthropic" }), false);
	assert.equal(applyServerTools(body, { provider: "anthropic" }, env), undefined);
	assert.equal(applyServerTools(body, { baseUrl: "https://api.example.com" }, env), undefined);
	assert.equal(applyServerTools(body, undefined, env), undefined);
	assert.deepEqual(body.tools, []);

	const viaBaseUrl = { tools: [] };
	applyServerTools(viaBaseUrl, { provider: "custom", baseUrl: "https://openrouter.ai/api/v1" }, env);
	assert.equal(viaBaseUrl.tools.length, 2);
});

test("payloads without a tools array are untouched", () => {
	for (const body of [{}, { tools: null }, { tools: "nope" }, null, "str"]) {
		assert.equal(applyServerTools(body, openrouter, env), undefined);
	}
});
