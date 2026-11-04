import assert from "node:assert/strict";
import { test } from "node:test";
import { Jimp } from "jimp";
import { Image, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { preparePreview } from "../extensions/image-previews/prepare.ts";
import { installPreviewPatch } from "../extensions/image-previews/patch.ts";

function transmittedPng(lines: string[]): Buffer {
	return Buffer.from([...lines.join("").matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map((m) => m[1]).join(""), "base64");
}

test("real PNG and JPEG uploads shrink, preserve originals, cache, and restore on unload", async () => {
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	setCellDimensions({ widthPx: 9, heightPx: 18 });
	const render = Image.prototype.render;
	let wake: (() => void) | undefined;
	let preparations = 0;
	const dispose = installPreviewPatch({
		rows: () => 30,
		requestRender: () => wake?.(),
		prepare: async (...args) => { preparations++; return preparePreview(...args); },
	});
	try {
		for (const mime of ["image/png", "image/jpeg"] as const) {
			const source = (await new Jimp({ width: 2400, height: 1600, color: 0x2277aaff }).getBuffer(mime)).toString("base64");
			const image = new Image(source, mime, { fallbackColor: (text) => text });
			const ready = new Promise<void>((resolve) => { wake = resolve; });
			assert.match(image.render(100).join(""), /Preparing/);
			await ready;
			const first = image.render(100);
			const decoded = await Jimp.fromBuffer(transmittedPng(first));
			assert.equal(decoded.width, 1024);
			assert.equal(decoded.height, 682);
			assert.equal(Reflect.get(image, "base64Data"), source);
			assert.equal(Reflect.get(image, "mimeType"), mime);
			assert.deepEqual(image.render(100), first);
			assert.ok(image.getImageId());
		}
		assert.equal(preparations, 2);
	} finally { dispose(); }
	assert.equal(Image.prototype.render, render);
});

test("small images never upscale; narrower panes regenerate preview", async () => {
	const small = (await new Jimp({ width: 24, height: 12, color: 0xff0000ff }).getBuffer("image/png")).toString("base64");
	const preview = await preparePreview(small, 1024, 768);
	assert.deepEqual([preview.widthPx, preview.heightPx], [24, 12]);
	let wake: (() => void) | undefined;
	const dispose = installPreviewPatch({ rows: () => 30, requestRender: () => wake?.() });
	try {
		const source = (await new Jimp({ width: 1200, height: 800, color: 0x00ff00ff }).getBuffer("image/png")).toString("base64");
		const image = new Image(source, "image/png", { fallbackColor: (text) => text });
		for (const [columns, expected] of [[100, 1024], [30, 504]]) {
			const ready = new Promise<void>((resolve) => { wake = resolve; });
			image.render(columns!);
			await ready;
			assert.equal((await Jimp.fromBuffer(transmittedPng(image.render(columns!)))).width, expected);
		}
	} finally { dispose(); }
});

test("failed processing never emits the oversized original and reload doesn't stack wrappers", async () => {
	const original = Image.prototype.render;
	let wake: (() => void) | undefined;
	const first = installPreviewPatch({ rows: () => 30, requestRender: () => {} });
	const second = installPreviewPatch({ rows: () => 30, requestRender: () => wake?.(), prepare: async () => { throw Error("bad image"); } });
	first();
	try {
		const image = new Image("invalid", "image/png", { fallbackColor: (text) => text });
		const ready = new Promise<void>((resolve) => { wake = resolve; });
		image.render(80);
		await ready;
		assert.match(image.render(80).join(""), /unavailable/);
		assert.equal(transmittedPng(image.render(80)).length, 0);
	} finally { second(); }
	assert.equal(Image.prototype.render, original);
});
