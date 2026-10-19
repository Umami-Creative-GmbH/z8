/**
 * Reads a rendered kiosk badge PDF the way a person and a scanner would (#1364):
 * the texts printed on the page and what its QR code decodes to. It knows only
 * enough of PDF for the files `renderKioskBadgePdf` writes (Flate streams, one
 * RGB image with a soft mask, standard-font hex strings), and fails loudly on
 * anything else rather than guess.
 */
import { inflateSync } from "node:zlib";
import jsQR from "jsqr";

type PdfStream = { dictionary: string; data: Buffer };

function streamsOf(pdf: Buffer): PdfStream[] {
	const text = pdf.toString("latin1");
	const pattern = /obj\s*<<((?:(?!endobj)[\s\S])*?)>>\s*stream\r?\n/g;
	const streams: PdfStream[] = [];
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		const dictionary = match[1] ?? "";
		const length = Number(/\/Length (\d+)/.exec(dictionary)?.[1]);
		if (!Number.isFinite(length)) throw new Error("PDF stream without a direct length");
		const start = match.index + match[0].length;
		const raw = pdf.subarray(start, start + length);
		const data = /\/Filter \/FlateDecode/.test(dictionary) ? inflateSync(raw) : raw;
		streams.push({ dictionary, data });
	}
	return streams;
}

function numberIn(dictionary: string, name: string): number {
	const value = Number(new RegExp(`/${name} (\\d+)`).exec(dictionary)?.[1]);
	if (!Number.isFinite(value)) throw new Error(`PDF image without /${name}`);
	return value;
}

/** The text of each text-showing operation on the PDF's pages, in drawing order. */
export function pdfTexts(pdf: Buffer): string[] {
	const texts: string[] = [];
	for (const stream of streamsOf(pdf)) {
		if (/\/Subtype \/Image/.test(stream.dictionary)) continue;
		const content = stream.data.toString("latin1");
		for (const operation of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
			const hex = [...(operation[1] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)]
				.map((chunk) => chunk[1])
				.join("");
			texts.push(Buffer.from(hex, "hex").toString("latin1"));
		}
	}
	return texts;
}

/** What the PDF's (single) RGB image decodes to as a QR code, or null when it decodes to nothing. */
export function pdfQrCodeText(pdf: Buffer): string | null {
	const { data, width, height } = pdfQrImage(pdf);
	return jsQR(data, width, height)?.data ?? null;
}

/** The PDF's (single) RGB image as RGBA pixels, as a camera frame drawn on a canvas holds them (#1367). */
export function pdfQrImage(pdf: Buffer): {
	data: Uint8ClampedArray;
	width: number;
	height: number;
} {
	const images = streamsOf(pdf).filter(
		(stream) =>
			/\/Subtype \/Image/.test(stream.dictionary) && /\/DeviceRGB/.test(stream.dictionary),
	);
	if (images.length !== 1) throw new Error(`Expected one RGB image, found ${images.length}`);
	const [image] = images as [PdfStream];
	const width = numberIn(image.dictionary, "Width");
	const height = numberIn(image.dictionary, "Height");
	if (
		numberIn(image.dictionary, "BitsPerComponent") !== 8 ||
		image.data.length !== width * height * 3
	) {
		throw new Error("Unexpected PDF image layout");
	}
	const rgba = new Uint8ClampedArray(width * height * 4);
	for (let pixel = 0; pixel < width * height; pixel += 1) {
		rgba[pixel * 4] = image.data[pixel * 3] ?? 0;
		rgba[pixel * 4 + 1] = image.data[pixel * 3 + 1] ?? 0;
		rgba[pixel * 4 + 2] = image.data[pixel * 3 + 2] ?? 0;
		rgba[pixel * 4 + 3] = 255;
	}
	return { data: rgba, width, height };
}
