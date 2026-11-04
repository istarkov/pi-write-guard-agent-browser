import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../extensions/write-guard/index.ts";

test("all shell syntax stays sandboxed with child-only browser settings", { skip: process.platform !== "darwin" }, async () => {
	const envKeys = ["AGENT_BROWSER_CONFIG", "AGENT_BROWSER_NAMESPACE", "AGENT_BROWSER_ARGS", "AGENT_BROWSER_IDLE_TIMEOUT_MS"];
	const before = envKeys.map((key) => process.env[key]);
	const handlers = new Map<string, Function>();
	const calls: unknown[][] = [];
	const api = {
		on: (name: string, handler: Function) => handlers.set(name, handler),
		exec: async (...args: unknown[]) => { calls.push(args); return { code: 0, stdout: "", stderr: "", killed: false }; },
	};
	extension(api as unknown as Parameters<typeof extension>[0]);
	const commands = [
		"echo ordinary",
		"agent-browser open about:blank & wait",
		"cat <<'JS' | agent-browser eval --stdin\n21*2\nJS",
		"bash /tmp/browser-script.sh",
		"echo $(printf agent-browser); touch /tmp/allowed",
	];
	for (const command of commands) {
		const event = { toolName: "bash", input: { command } };
		assert.equal(await handlers.get("tool_call")!(event, { cwd: "/tmp" }), undefined);
		assert.ok(event.input.command.startsWith("'/usr/bin/sandbox-exec' '-p' "));
		assert.ok(event.input.command.includes("(deny file-write*)"));
		assert.ok(event.input.command.includes("AGENT_BROWSER_CONFIG="));
		assert.ok(event.input.command.includes("AGENT_BROWSER_NAMESPACE=pi-"));
		assert.ok(event.input.command.endsWith("'" + command.replaceAll("'", "'\\''") + "'"));
	}
	assert.deepEqual(envKeys.map((key) => process.env[key]), before);
	const blocked = await handlers.get("tool_call")!({ toolName: "write", input: { path: "/etc/pi-guard-test" } }, { cwd: "/tmp" });
	assert.equal(blocked.block, true);
	await handlers.get("session_shutdown")!();
	assert.equal(calls.length, 1);
	assert.equal(calls[0]![0], "/usr/bin/sandbox-exec");
	const args = calls[0]![1] as string[];
	assert.deepEqual(args.slice(-3), ["agent-browser", "close", "--all"]);
	assert.ok(args.includes("AGENT_BROWSER_IDLE_TIMEOUT_MS=300000"));
});
