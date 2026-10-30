import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	buildProfile,
	canonicalize,
	classifyBashCommand,
	defaultWriteRoots,
	escapeProfilePath,
	isBrowserInvocation,
	isWritable,
	shellQuote,
	splitCommandSegments,
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

test("isBrowserInvocation catches wrapped and chained agent-browser calls", () => {
	const cases = [
		"agent-browser open https://x",
		"  agent-browser   snapshot",
		"cd /tmp && timeout 120 agent-browser --session s open https://x",
		"cd /tmp && agent-browser open x",
		"cd /tmp; agent-browser open x",
		"timeout 120 agent-browser open x",
		"timeout -s KILL 120 agent-browser open x",
		"env FOO=1 agent-browser open x",
		"FOO=1 agent-browser open x",
		"npx agent-browser open x",
		"npx --yes agent-browser@latest open x",
		"bunx agent-browser open x",
		"pnpx agent-browser open x",
		"sudo agent-browser open x",
		"nohup agent-browser open x",
		"/Users/x/.nvm/versions/node/v24/bin/agent-browser open x",
		"cd /tmp && agent-browser open x 2>&1 | tail -20",
		"agent-browser open x &",
		"echo started && agent-browser open x",
	];
	for (const command of cases) {
		assert.equal(isBrowserInvocation(command), true, command);
	}
});

test("isBrowserInvocation does not trust a substring or a non-browser head", () => {
	const cases = [
		"echo agent-browser",
		"ls -la",
		"",
		"grep agent-browser log.txt",
		"cat 'agent-browser'",
		"npm install agent-browser",
	];
	for (const command of cases) {
		assert.equal(isBrowserInvocation(command), false, command);
	}
});

test("classifyBashCommand blocks mixing agent-browser with a writer", () => {
	const verdict = classifyBashCommand("rm -rf /Users/x/keep && agent-browser open x");
	assert.equal(verdict.kind, "blocked");
	assert.match((verdict as { reason: string }).reason, /rm -rf/);

	assert.equal(classifyBashCommand("agent-browser open x > /Users/x/keep/out").kind, "blocked");
	assert.equal(classifyBashCommand("agent-browser open x > ~/Desktop/out").kind, "blocked");
	assert.equal(classifyBashCommand("cd /tmp && echo $(rm -rf /Users/x) && agent-browser open x").kind, "blocked");
	assert.equal(classifyBashCommand("node script.mjs && agent-browser open x").kind, "blocked");
	assert.equal(classifyBashCommand("sed -i '' s/a/b/ f && agent-browser open x").kind, "blocked");
	assert.equal(classifyBashCommand("sort -o f g && agent-browser open x").kind, "blocked");
});

test("classifyBashCommand stays outside when the pipe only reads or writes a root", () => {
	const roots = [canonicalize(tmpdir())];
	assert.equal(classifyBashCommand("agent-browser open x | jq .", roots).kind, "outside");
	assert.equal(classifyBashCommand("agent-browser open x > /dev/null 2>&1", roots).kind, "outside");
	assert.equal(
		classifyBashCommand(`agent-browser open x > ${join(tmpdir(), "shot.json")}`, roots, tmpdir()).kind,
		"outside",
	);
	assert.equal(classifyBashCommand("agent-browser open x > ./out.json", roots, tmpdir()).kind, "outside");
	assert.equal(classifyBashCommand("ls -la", roots).kind, "sandbox");
});

test("splitCommandSegments keeps quoted control operators inside one segment", () => {
	assert.deepEqual(splitCommandSegments("a && b; c | d"), ["a", "b", "c", "d"]);
	assert.deepEqual(splitCommandSegments("echo 'a && b'"), ["echo 'a && b'"]);
	assert.deepEqual(splitCommandSegments('echo "a; b" && c'), ['echo "a; b"', "c"]);
	assert.deepEqual(splitCommandSegments("a 2>&1 &"), ["a 2>&1"]);
	assert.deepEqual(splitCommandSegments("   "), []);
});
