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
	/** Pi's global agent directory (settings, extensions, models, installs). */
	agentDir?: string;
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
 * Roots where shell commands may write: the session cwd, Pi's agent directory
 * (global extensions, settings, models, installs), downloads, temp, and the
 * package-manager caches that would otherwise break sandboxed installs.
 */
export function defaultWriteRoots({
	cwd,
	home = homedir(),
	tmp = tmpdir(),
	agentDir = process.env.PI_CODING_AGENT_DIR ?? resolve(home, ".pi", "agent"),
}: WriteRootsOptions): string[] {
	return [
		cwd,
		agentDir,
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
 * Commands that cannot write files on their own, so they may share a bash call
 * with agent-browser without losing the write guard for anything meaningful.
 */
const HARMLESS = new Set([
	"cd", "pushd", "popd", "pwd", "echo", "printf", "true", "false", ":",
	"export", "unset", "set", "sleep", "wait", "test", "[", "times", "hash",
	"umask", "head", "tail", "cat", "grep", "egrep", "fgrep", "wc", "uniq",
	"cut", "tr", "jq", "nl", "column", "less", "more", "sort", "sed",
]);

/** Wrappers that only forward to the real program; skipped before classifying. */
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpx"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Split a shell command into simple-command segments, honoring quotes. */
export function splitCommandSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i]!;

		if (quote === "'") {
			current += ch;
			if (ch === "'") quote = null;
			continue;
		}
		if (quote === '"') {
			current += ch;
			if (ch === "\\" && i + 1 < command.length) current += command[++i]!;
			else if (ch === '"') quote = null;
			continue;
		}
		if (ch === "\\" && i + 1 < command.length) {
			current += ch;
			current += command[++i]!;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			current += ch;
			continue;
		}
		// `2>&1` / `>&-` are fd duplications, not control operators.
		if (ch === "&" && /[<>]$/.test(current)) {
			current += ch;
			while (i + 1 < command.length && /[0-9-]/.test(command[i + 1]!)) current += command[++i]!;
			continue;
		}
		if (ch === "&" || ch === "|" || ch === ";" || ch === "\n") {
			segments.push(current);
			current = "";
			// `&&`, `||`, `|&` and `;;` collapse into one control operator.
			while (i + 1 < command.length && /[&|;]/.test(command[i + 1]!)) i++;
			continue;
		}
		current += ch;
	}

	segments.push(current);
	return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

/** Split a segment into words, stripping shell quoting. */
export function splitWords(segment: string): string[] {
	const words: string[] = [];
	let current = "";
	let has = false;
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i]!;

		if (quote === "'") {
			has = true;
			if (ch === "'") quote = null;
			else current += ch;
			continue;
		}
		if (quote === '"') {
			has = true;
			if (ch === "\\" && i + 1 < segment.length) current += segment[++i]!;
			else if (ch === '"') quote = null;
			else current += ch;
			continue;
		}
		if (ch === "\\" && i + 1 < segment.length) {
			has = true;
			current += segment[++i]!;
			continue;
		}
		if (ch === "'" || ch === '"') {
			has = true;
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (has) words.push(current);
			current = "";
			has = false;
			continue;
		}
		has = true;
		current += ch;
	}

	if (has) words.push(current);
	return words;
}

/** Drop leading `VAR=value` assignments and helper wrappers (`timeout`, `npx`…). */
function unwrap(words: readonly string[]): string[] {
	let i = 0;
	while (i < words.length && i < 64) {
		const word = words[i]!;
		if (ASSIGNMENT.test(word)) {
			i++;
			continue;
		}

		const base = basename(word);
		if (base === "env") {
			i++;
			while (i < words.length && (words[i]!.startsWith("-") || ASSIGNMENT.test(words[i]!))) i++;
			continue;
		}
		if (base === "timeout") {
			i++;
			while (i < words.length && words[i]!.startsWith("-")) {
				// `-s SIGNAL` / `-k DURATION` consume the next word.
				i += words[i] === "-s" || words[i] === "-k" ? 2 : 1;
			}
			i++; // the duration itself
			continue;
		}
		if (base === "sudo" || base === "doas") {
			i++;
			while (i < words.length && words[i]!.startsWith("-")) {
				const flag = words[i]!;
				i += flag === "-u" || flag === "-g" || flag === "-p" || flag === "-C" ? 2 : 1;
			}
			continue;
		}
		if (base === "nice") {
			i++;
			i += words[i] === "-n" ? 2 : words[i]?.startsWith("-") ? 1 : 0;
			continue;
		}
		if (base === "stdbuf") {
			i++;
			while (i < words.length && words[i]!.startsWith("-")) i++;
			continue;
		}
		if (base === "nohup" || base === "command" || base === "exec" || base === "time") {
			i++;
			continue;
		}
		break;
	}

	return words.slice(i);
}

/** Flags that turn an otherwise read-only helper into a file writer. */
function writesViaFlag(program: string, args: readonly string[]): boolean {
	if (program === "sed") return args.some((arg) => /^-[a-zA-Z]*i/.test(arg));
	if (program === "sort") return args.some((arg) => arg === "-o" || /^--output/.test(arg));
	return false;
}

type SegmentRole = "browser" | "harmless" | "other";

function classifyWords(words: readonly string[]): SegmentRole {
	const rest = unwrap(words);
	if (rest.length === 0) return "harmless";

	// Strip subshell/brace grouping: `(cd /tmp && agent-browser x)`.
	const head = rest[0]!.replace(/^[(]+/, "").replace(/[)]+$/, "");
	if (head.length === 0) return "harmless";

	const program = basename(head.replace(/^[{]+/, "").replace(/[}]+$/, ""));
	if (program.length === 0) return "harmless";
	if (program === "agent-browser") return "browser";

	if (PACKAGE_RUNNERS.has(program)) {
		let i = 1;
		while (i < rest.length && rest[i]!.startsWith("-")) i++;
		const pkg = rest[i]?.split("@")[0];
		if (pkg !== undefined && basename(pkg) === "agent-browser") return "browser";
		return "other";
	}

	if (HARMLESS.has(program)) return writesViaFlag(program, rest.slice(1)) ? "other" : "harmless";
	return "other";
}

/** Redirect sinks that are never file writes. */
function isSink(target: string): boolean {
	return /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/.test(target);
}

/**
 * Does this segment write to a path outside the allowed roots? Redirections to
 * a writable root (or /dev/null) are fine; command substitution is not, because
 * we cannot see what it writes.
 */
function hasFileWrite(segment: string, roots: readonly string[], cwd: string): boolean {
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i]!;

		if (quote === "'") {
			if (ch === "'") quote = null;
			continue;
		}
		if (quote === '"') {
			if (ch === "\\") i++;
			else if (ch === '"') quote = null;
			continue;
		}
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (ch === "`") return true;
		if (ch === "$" && segment[i + 1] === "(") return true;

		if (ch !== ">") continue;

		const rest = segment.slice(i);
		const dup = /^>&(?:[0-9]+|-)/.exec(rest);
		if (dup) {
			i += dup[0].length - 1;
			continue;
		}

		const redirect = /^>>?\|?\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/.exec(rest);
		if (!redirect) return true;

		const raw = redirect[1] ?? redirect[2] ?? redirect[3] ?? "";
		const target = /^~\//.test(raw)
			? resolve(homedir(), raw.slice(2))
			: raw.startsWith("/")
				? resolve(raw)
				: resolve(cwd, raw);
		if (!isSink(raw) && !isWritable(roots, canonicalize(target))) return true;

		i += redirect[0].length - 1;
	}

	return false;
}

export type BashVerdict =
	| { kind: "sandbox" }
	| { kind: "outside" }
	| { kind: "blocked"; reason: string };

/**
 * Decide how a bash command must run.
 *
 * agent-browser launches Chromium, and macOS refuses to initialize a sandbox
 * inside ours (`forbidden-sandbox-reinit`), so an agent-browser call has to run
 * outside the sandbox. That exception is only granted when every segment of the
 * command is agent-browser itself or provably read-only: `cd /tmp && timeout 120
 * agent-browser ...` runs outside, `rm -rf x && agent-browser ...` is refused
 * rather than silently losing the write guard. This is an accident guard, not a
 * security boundary.
 */
export function classifyBashCommand(
	command: string,
	roots: readonly string[] = [],
	cwd: string = process.cwd(),
): BashVerdict {
	const segments = splitCommandSegments(command);
	if (segments.length === 0) return { kind: "sandbox" };

	const analysed = segments.map((segment) => ({
		segment,
		role: classifyWords(splitWords(segment)),
		writes: hasFileWrite(segment, roots, cwd),
	}));

	if (!analysed.some((entry) => entry.role === "browser")) return { kind: "sandbox" };

	const unsafe = analysed.find((entry) => entry.role === "other");
	if (unsafe) {
		return {
			kind: "blocked",
			reason:
				"agent-browser cannot run inside the Seatbelt sandbox (Chromium fails with forbidden-sandbox-reinit), " +
				`but this command also runs \`${unsafe.segment}\`, which must stay sandboxed. ` +
				"Run the agent-browser call in its own bash tool call; only cd/echo and pipes to read-only tools may share it.",
		};
	}

	const writer = analysed.find((entry) => entry.writes);
	if (writer) {
		return {
			kind: "blocked",
			reason:
				"agent-browser cannot run inside the Seatbelt sandbox (Chromium fails with forbidden-sandbox-reinit), " +
				`but \`${writer.segment}\` writes outside the allowed roots (or uses command substitution). ` +
				"Run the agent-browser call in its own bash tool call.",
		};
	}

	return { kind: "outside" };
}

/** True when the whole command is safe to run outside the sandbox. */
export function isBrowserInvocation(
	command: string,
	roots: readonly string[] = [],
	cwd: string = process.cwd(),
): boolean {
	return classifyBashCommand(command, roots, cwd).kind === "outside";
}

/** POSIX single-quote a value for safe embedding in a shell command. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
