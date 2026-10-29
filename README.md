# pi-write-guard

A Pi extension for macOS: shell commands can **read anywhere but write only inside a few roots**, using the Seatbelt sandbox (`sandbox-exec`).

A plain `agent-browser` call runs **outside** the sandbox, because Chromium cannot initialize its own sandbox nested inside ours (macOS rejects it with `forbidden-sandbox-reinit`) and would crash.

Write roots: the session working directory, `~/Downloads`, `/tmp` and `$TMPDIR`, package-manager caches (`~/.npm`, `~/.bun`, `~/.cache`, `~/.cargo`, `~/Library/Caches`, `~/Library/pnpm`), and `~/.agent-browser`. Edit `defaultWriteRoots()` in [`extensions/write-guard/policy.ts`](extensions/write-guard/policy.ts) to change them.

## Install

```bash
pi install /absolute/path/to/pi-write-guard      # local checkout
pi install git:github.com/istarkov/pi-write-guard-agent-browser   # git
```

A local package is loaded from its path **without copying**. Remove any standalone `.pi/extensions/write-guard.ts` before installing the package: otherwise both load and the nested `sandbox-exec` fails.

This is an accident guard, not a security boundary. Network is not restricted.
