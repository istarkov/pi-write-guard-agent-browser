/**
 * write-guard: read anywhere, write only inside a few roots.
 *
 * - `bash` runs under macOS `sandbox-exec`, so the kernel denies writes outside
 *   the roots even from scripts and interpreters (no shell-string parsing).
 * - `write` / `edit` are path-checked because they never go through the shell.
 *
 * A deliberate exception: a plain `agent-browser` invocation runs outside the
 * sandbox, because Chromium cannot initialize its own sandbox nested in ours.
 */

import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	buildProfile,
	canonicalize,
	defaultWriteRoots,
	isBrowserInvocation,
	isWritable,
	shellQuote,
} from "./policy.ts";

export default function (pi: ExtensionAPI): void {
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

		if (
			process.platform === "darwin" &&
			event.toolName === "bash" &&
			typeof input.command === "string" &&
			!isBrowserInvocation(input.command)
		) {
			input.command = `/usr/bin/sandbox-exec -p ${shellQuote(buildProfile(roots))} /bin/bash -c ${shellQuote(input.command)}`;
		}
	});
}
