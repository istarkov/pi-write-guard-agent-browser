import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { buildProfile, canonicalize, defaultWriteRoots, isWritable, shellQuote } from "./policy.ts";

export default function (pi: ExtensionAPI): void {
	const namespace = `pi-${process.pid}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
	const config = fileURLToPath(new URL("./agent-browser.json", import.meta.url));
	const browserEnv = [
		`AGENT_BROWSER_CONFIG=${config}`,
		`AGENT_BROWSER_NAMESPACE=${namespace}`,
		"AGENT_BROWSER_IDLE_TIMEOUT_MS=300000",
	];
	let lastCwd: string | undefined;

	pi.on("tool_call", (event, ctx) => {
		const roots = defaultWriteRoots({ cwd: ctx.cwd });
		const input = event.input as { path?: unknown; command?: unknown };

		if (
			(event.toolName === "write" || event.toolName === "edit") &&
			typeof input.path === "string"
		) {
			const target = canonicalize(resolve(ctx.cwd, input.path));
			if (!isWritable(roots, target)) {
				return { block: true, reason: `Refusing to write outside allowed roots: ${target}` };
			}
		}

		if (process.platform === "darwin" && event.toolName === "bash" && typeof input.command === "string") {
			lastCwd = ctx.cwd;
			input.command = [
				"/usr/bin/sandbox-exec", "-p", buildProfile(roots),
				"/usr/bin/env", ...browserEnv, "/bin/bash", "-c", input.command,
			].map(shellQuote).join(" ");
		}
	});

	pi.on("session_shutdown", async () => {
		if (!lastCwd) return;
		try {
			await pi.exec("/usr/bin/sandbox-exec", [
				"-p", buildProfile(defaultWriteRoots({ cwd: lastCwd })),
				"/usr/bin/env", ...browserEnv, "agent-browser", "close", "--all",
			], { cwd: lastCwd, timeout: 10000 });
		} catch {
			// The idle timeout also releases browsers when Pi cannot shut down cleanly.
		}
	});
}
