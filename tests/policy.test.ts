import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	buildProfile,
	canonicalize,
	defaultWriteRoots,
	escapeProfilePath,
	isBrowserInvocation,
	isWritable,
	shellQuote,
} from "../extensions/write-guard/policy.ts";

test("isWritable accepts a root and its children, rejects siblings", () => {
	const roots = ["/a", "/b/c"];
	assert.equal(isWritable(roots, "/a"), true);
	assert.equal(isWritable(roots, "/a/x/y"), true);
	assert.equal(isWritable(roots, "/ab"), false, "prefix must not match a sibling");
	assert.equal(isWritable(roots, "/b/c/d"), true);
	assert.equal(isWritable(roots, "/b"), false);
	assert.equal(isWritable(roots, "/b/cd"), false);
});

test("isBrowserInvocation matches plain agent-browser and npx, nothing else", () => {
	assert.equal(isBrowserInvocation("agent-browser open https://x"), true);
	assert.equal(isBrowserInvocation("  agent-browser   snapshot"), true);
	assert.equal(isBrowserInvocation("npx agent-browser open x"), true);
	assert.equal(isBrowserInvocation("echo agent-browser"), false);
	assert.equal(isBrowserInvocation("ls -la"), false);
	assert.equal(isBrowserInvocation(""), false);
});

test("buildProfile lists every root as a write subpath and denies writes overall", () => {
	const profile = buildProfile(["/Users/x/proj", "/private/tmp"]);
	assert.match(profile, /\(deny file-write\*\)/);
	assert.match(profile, /\(subpath "\/Users\/x\/proj"\)/);
	assert.match(profile, /\(subpath "\/private\/tmp"\)/);
});

test("escapeProfilePath escapes quotes and backslashes", () => {
	assert.equal(escapeProfilePath('/a"b'), '/a\\"b');
	assert.equal(escapeProfilePath("/a\\b"), "/a\\\\b");
});

test("defaultWriteRoots always includes cwd and temp", () => {
	const roots = defaultWriteRoots({ cwd: "/Users/x/proj", home: "/Users/x", tmp: "/tmp/t" });
	assert.ok(roots.includes("/Users/x/proj"));
	assert.ok(roots.some((root) => root.endsWith("/tmp/t") || root === "/tmp/t"));
});

test("defaultWriteRoots includes Pi's agent dir and honors the override", () => {
	const roots = defaultWriteRoots({
		cwd: "/Users/x/proj",
		home: "/Users/x",
		tmp: "/tmp/t",
		agentDir: "/Users/x/.pi/agent",
	});
	assert.ok(roots.includes("/Users/x/.pi/agent"));

	const custom = defaultWriteRoots({
		cwd: "/Users/x/proj",
		home: "/Users/x",
		tmp: "/tmp/t",
		agentDir: "/Users/x/custom-agent",
	});
	assert.ok(custom.includes("/Users/x/custom-agent"));
	assert.ok(!custom.includes("/Users/x/.pi/agent"));
});

test("defaultWriteRoots defaults agentDir from PI_CODING_AGENT_DIR", () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = "/Users/x/env-agent";
	try {
		const roots = defaultWriteRoots({ cwd: "/Users/x/proj", home: "/Users/x", tmp: "/tmp/t" });
		assert.ok(roots.includes("/Users/x/env-agent"));
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});

test("canonicalize resolves a new path through its existing ancestor", () => {
	const target = join(tmpdir(), "wg-nope", "file.txt");
	assert.equal(canonicalize(target), join(realpathSync(tmpdir()), "wg-nope", "file.txt"));
});

test("isWritable accepts a new file under a canonicalized root", () => {
	const root = canonicalize(tmpdir());
	assert.equal(isWritable([root], canonicalize(join(tmpdir(), "wg-new", "f"))), true);
});

test("shellQuote wraps and escapes single quotes", () => {
	assert.equal(shellQuote("plain"), "'plain'");
	assert.equal(shellQuote("a'b"), "'a'\\''b'");
});
