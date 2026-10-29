import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildProfile,
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

test("shellQuote wraps and escapes single quotes", () => {
	assert.equal(shellQuote("plain"), "'plain'");
	assert.equal(shellQuote("a'b"), "'a'\\''b'");
});
