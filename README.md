# pi-write-guard

A Pi extension for macOS: shell commands can **read anywhere but write only inside a few roots**, using the Seatbelt sandbox (`sandbox-exec`).

An `agent-browser` call runs **outside** the sandbox, because Chromium cannot initialize its own sandbox nested inside ours (macOS rejects it with `forbidden-sandbox-reinit`) and would crash. The whole command leaves the sandbox only when every segment is agent-browser itself or provably read-only, so wrappers and chains work: `cd /tmp && timeout 120 agent-browser --session x open …`, `env FOO=1 agent-browser …`, `npx agent-browser …`, `… 2>&1 | tail -20`. Mixing agent-browser with anything else (`rm -rf x && agent-browser …`, `… > ~/Desktop/out`) is **blocked** with a hint to split it into separate `bash` calls, instead of silently losing the write guard.

Write roots: the session working directory, Pi's agent directory (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR`), `~/Downloads`, `/tmp` and `$TMPDIR`, package-manager caches (`~/.npm`, `~/.bun`, `~/.cache`, `~/.cargo`, `~/Library/Caches`, `~/Library/pnpm`), and `~/.agent-browser`. Edit `defaultWriteRoots()` in [`extensions/write-guard/policy.ts`](extensions/write-guard/policy.ts) to change them.

Also bundles `openrouter-web-search`: injects OpenRouter's server-side `openrouter:web_search` and `openrouter:datetime` tools into outgoing requests (`PI_OPENROUTER_WEB_SEARCH=0`, `PI_OPENROUTER_DATETIME=0` and `PI_OPENROUTER_DATETIME_TIMEZONE` configure them).

## Install

```bash
pi install /absolute/path/to/pi-write-guard      # local checkout → ~/.pi/agent/settings.json (global)
pi install -l /absolute/path/to/pi-write-guard   # local checkout → .pi/settings.json (project)
pi install git:github.com/istarkov/pi-write-guard-agent-browser   # git
```

A local package is loaded from its path **without copying**. Remove any standalone `.pi/extensions/write-guard.ts` before installing the package: otherwise both load and the nested `sandbox-exec` fails. Likewise, never hand-copy extensions into `~/.pi/agent/extensions/` or `.pi/extensions/` — they go stale and conflict with the package, which is the only source of truth.

This is an accident guard, not a security boundary. Network is not restricted.
