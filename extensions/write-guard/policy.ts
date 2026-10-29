/**
 * Pure helpers for the write-guard. No Pi runtime imports here, so the logic
 * stays unit-testable with plain `node --test`.
 */

import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export interface WriteRootsOptions {
	/** Session working directory: the one place writes are always allowed. */
	cwd: string;
	home?: string;
	tmp?: string;
}

/**
 * Resolve to the kernel's view of a path (macOS: /tmp -> /private/tmp). A path
 * that does not exist yet is resolved through its nearest existing ancestor, so
 * writing a new file under an aliased root (/tmp, $TMPDIR) is not misjudged.
 */
export function canonicalize(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		const parent = dirname(path);
		if (parent === path) return path;
		return join(canonicalize(parent), basename(path));
	}
}

/**
 * Roots where shell commands may write: the session cwd, downloads, temp, and
 * the package-manager caches that would otherwise break sandboxed installs.
 */
export function defaultWriteRoots({ cwd, home = homedir(), tmp = tmpdir() }: WriteRootsOptions): string[] {
	return [
		cwd,
		resolve(home, "Downloads"),
		"/tmp",
		tmp,
		resolve(home, ".npm"),
		resolve(home, ".bun"),
		resolve(home, ".cache"),
		resolve(home, "Library/Caches"),
		resolve(home, "Library/pnpm"),
		resolve(home, ".cargo"),
		resolve(home, ".agent-browser"),
	].map(canonicalize);
}

/** Escape a path for a double-quoted Seatbelt profile string. */
export function escapeProfilePath(path: string): string {
	return path.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/** Build a Seatbelt profile: read anywhere, write only inside the roots. */
export function buildProfile(roots: readonly string[]): string {
	const allowed = roots.map((root) => `(subpath "${escapeProfilePath(root)}")`).join(" ");
	return (
		"(version 1)(allow default)(deny file-write*)" +
		`(allow file-write* ${allowed}` +
		' (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))'
	);
}

/** True when `path` is a root or lives inside one (prefix-safe). */
export function isWritable(roots: readonly string[], path: string): boolean {
	return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

/**
 * agent-browser launches Chromium, and macOS refuses to initialize a sandbox
 * inside ours (`forbidden-sandbox-reinit`), so a plain agent-browser call is
 * allowed to run outside. This is an accident guard, not a security boundary.
 */
export function isBrowserInvocation(command: string): boolean {
	const [first, second] = command.trim().split(/\s+/);
	return first === "agent-browser" || (first === "npx" && second === "agent-browser");
}

/** POSIX single-quote a value for safe embedding in a shell command. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
