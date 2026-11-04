import { execFile } from "node:child_process";
import { Jimp } from "jimp";

export interface Preview {
	data: string;
	widthPx: number;
	heightPx: number;
}

/** Same pipeline as autotester: fit without upscaling, then optional pngquant. */
export async function preparePreview(data: string, width: number, height: number): Promise<Preview> {
	const decoded = await Jimp.fromBuffer(Buffer.from(data, "base64"));
	const scale = Math.min(1, width / decoded.width, height / decoded.height);
	const widthPx = Math.max(1, Math.floor(decoded.width * scale));
	const heightPx = Math.max(1, Math.floor(decoded.height * scale));
	if (widthPx !== decoded.width || heightPx !== decoded.height) decoded.resize({ w: widthPx, h: heightPx });
	const png = await decoded.getBuffer("image/png");
	const optimized = await new Promise<Buffer>((resolve) => {
		const child = execFile("pngquant", ["--quality", "0-20", "--speed", "1", "--strip", "-"],
			{ encoding: "buffer", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout) => resolve(!error && stdout.length < png.length ? stdout : png));
		child.stdin?.on("error", () => resolve(png));
		child.stdin?.end(png);
	});
	return { data: optimized.toString("base64"), widthPx, heightPx };
}
