import { createHash } from "node:crypto";
import { Image, getCapabilities, getCellDimensions } from "@earendil-works/pi-tui";
import { preparePreview, type Preview } from "./prepare.ts";

interface Entry {
	preview?: Preview;
	error?: boolean;
	bytes: number;
}

interface Options {
	requestRender: () => void;
	rows: () => number;
	prepare?: typeof preparePreview;
}

const patchKey = Symbol.for("istarkov.pi.image-previews.patch");
const cacheLimit = 16 * 1024 * 1024;

/** Version-sensitive adapter: only Image's render-time copy is changed, never messages. */
export function installPreviewPatch(options: Options): () => void {
	const previous: unknown = Reflect.get(Image.prototype, patchKey);
	if (typeof previous === "function") previous();
	const originalRender = Image.prototype.render;
	const cache = new Map<string, Entry>();
	const patched = new Set<WeakRef<Image>>();
	const instances = new WeakMap<Image, { source: string; width: number; height: number; entry: Entry; rendered?: Preview }>();
	let bytes = 0;
	let active = true;
	let queue = Promise.resolve();
	const prepare = options.prepare ?? preparePreview;
	function trimCache() {
		for (const [key, entry] of cache) {
			if (bytes <= cacheLimit && cache.size <= 64) break;
			if (!entry.preview && !entry.error) continue;
			cache.delete(key);
			bytes -= entry.bytes;
		}
	}
	function render(this: Image, width: number): string[] {
		if (!getCapabilities().images) return originalRender.call(this, width);
		// TS-private fields are ordinary properties in Pi 1.4/1.5. Validate at runtime
		// rather than assuming a future Pi still uses this representation.
		const source: unknown = Reflect.get(this, "base64Data");
		const mime: unknown = Reflect.get(this, "mimeType");
		const imageOptions: unknown = Reflect.get(this, "options");
		if (typeof source !== "string" || typeof mime !== "string" || !imageOptions || typeof imageOptions !== "object") {
			return ["[Image preview unavailable: incompatible Pi version]"];
		}
		const configuredWidth: unknown = Reflect.get(imageOptions, "maxWidthCells");
		const configuredHeight: unknown = Reflect.get(imageOptions, "maxHeightCells");
		const cells = getCellDimensions();
		const columns = Math.max(1, Math.min(width - 2, typeof configuredWidth === "number" ? configuredWidth : 60));
		const rows = Math.max(1, Math.min(options.rows() - 4, typeof configuredHeight === "number" ? configuredHeight : Math.ceil(columns * cells.widthPx / cells.heightPx)));
		// A 2x preview keeps text crisp; pixel caps bound decoded RGBA, not just PNG bytes.
		const maxWidth = Math.max(1, Math.min(1024, Math.floor(columns * cells.widthPx * 2)));
		const maxHeight = Math.max(1, Math.min(768, Math.floor(rows * cells.heightPx * 2)));
		let instance = instances.get(this);
		const same = instance?.source === source && instance.width === maxWidth && instance.height === maxHeight;
		const key = same ? undefined : `${createHash("sha256").update(source).digest("hex")}:${maxWidth}:${maxHeight}`;
		let entry = same ? instance?.entry : cache.get(key!);
		if (!entry) {
			entry = { bytes: 0 };
			cache.set(key!, entry);
			const pending = entry;
			// Decode/quantize off the synchronous render path, one image at a time.
			queue = queue.then(async () => {
				if (!active) return;
				try {
					const preview = await prepare(source, maxWidth, maxHeight);
					if (!active) return;
					pending.preview = preview;
					pending.bytes = preview.data.length;
					bytes += pending.bytes;
				} catch { pending.error = true; }
				if (active) { trimCache(); options.requestRender(); }
			});
		}
		if (!same) {
			if (!instance) patched.add(new WeakRef(this));
			instance = { source, width: maxWidth, height: maxHeight, entry };
			instances.set(this, instance);
		}
		if (!entry.preview) return [entry.error ? "[Image preview unavailable; original retained]" : "[Preparing image preview…]"];
		const fields = ["base64Data", "mimeType", "dimensions", "pngData"];
		const saved = fields.map((field) => Reflect.get(this, field));
		Reflect.set(this, "base64Data", entry.preview.data);
		Reflect.set(this, "mimeType", "image/png");
		Reflect.set(this, "dimensions", { widthPx: entry.preview.widthPx, heightPx: entry.preview.heightPx });
		Reflect.set(this, "pngData", undefined);
		// Image's built-in cache is width-only; previews also depend on rows and cell size.
		if (instance?.rendered !== entry.preview) {
			this.invalidate();
			if (instance) instance.rendered = entry.preview;
		}
		try { return originalRender.call(this, width); }
		finally { fields.forEach((field, index) => Reflect.set(this, field, saved[index])); }
	}
	Image.prototype.render = render;
	function dispose() {
		if (!active) return;
		active = false;
		if (Image.prototype.render === render) Image.prototype.render = originalRender;
		for (const image of patched) image.deref()?.invalidate();
		patched.clear();
		cache.clear();
		if (Reflect.get(Image.prototype, patchKey) === dispose) Reflect.deleteProperty(Image.prototype, patchKey);
	}
	Reflect.set(Image.prototype, patchKey, dispose);
	return dispose;
}
