# pi-write-guard

macOS Seatbelt guard for Pi: **read anywhere, write only to allowed roots**. All bash commands stay sandboxed, including scripts, pipes, heredocs, and `agent-browser`. The `write` and `edit` tools are path-checked.

Writes are allowed in the working directory, Pi's agent directory, Downloads, temp directories, package-manager caches, and agent-browser state. See [`defaultWriteRoots()`](extensions/write-guard/policy.ts) for the exact list.

## Install

```bash
pi install /absolute/path/to/pi-write-guard
# or
pi install git:github.com/istarkov/pi-write-guard-agent-browser
```

Add `-l` for project-only installation. Local packages load directly from the checkout. Remove standalone copies of the extension to avoid double sandboxing. Restart Pi or run `/reload` after updates.

## Browser

- Pi-only config disables Chrome's inner sandbox (`--no-sandbox`); outer Seatbelt stays active. Global browser settings, Codex, and Claude are unaffected.
- Each Pi has its own browser namespace. Use `--session` for independent browsers; state persists only while live unless explicitly saved/restored.
- Browsers close on Pi shutdown, with a five-minute idle timeout as fallback.

Intended for local/dev testing. This is an accident guard: reads and network are unrestricted, and Chrome's renderer isolation is disabled.

## OpenRouter

Also includes server-side web search and datetime tools. Disable with `PI_OPENROUTER_WEB_SEARCH=0` or `PI_OPENROUTER_DATETIME=0`; set timezone with `PI_OPENROUTER_DATETIME_TIMEZONE`.

## Image previews for Rex

Includes a terminal-only image preview extension to reduce Rex snapshot size. It fits PNG/JPEG images to the pane at 2× cell resolution (at most 1024×768 pixels), without upscaling, then applies optional `pngquant --quality 0-20 --speed 1 --strip`. If pngquant is unavailable, it uses the resized PNG. Model inputs and saved session images retain their original data.

Install dependencies with `bun install`, reload Pi with `/reload`, and enable **Show images** in `/settings`. The extension does not change that setting. Disable the extension with `PI_IMAGE_PREVIEWS=0` before starting Pi.

Tested in an interactive Pi 1.5.0 Rex pane with eight 2400×1600 PNG/JPEG images: actual terminal uploads were 960×640 at that pane size (18.75 MiB of decoded RGBA instead of 117.19 MiB). Resizing matters because Rex's snapshot limit counts decoded pixels, not compressed file size. This reduces growth; it does not impose a total history budget or guarantee unlimited image scrollback.

Implementation wraps Pi TUI's Image renderer and restores it on shutdown/reload; no Pi source files are modified. This adapter relies on Pi 1.4/1.5 runtime fields and should be rechecked after Pi upgrades. Preview preparation is queued; pending or failed previews show text instead of uploading a full-size original. Animated/unsupported formats are not guaranteed.
