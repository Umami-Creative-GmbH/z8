/**
 * #1367: reading a kiosk badge's QR code from the kiosk camera's frames, on the
 * device. The browser's own barcode detector when it reads QR codes, else a
 * small decoder over the frame drawn on an in-memory canvas.
 */
import { describe, expect, it, vi } from "vitest";
import { normalizeKioskBadgeCredential } from "./badge-credential";
import { pdfQrImage } from "./badge-pdf.test.fixture";
import { createKioskQrDecoder } from "./camera-qr-decoder";

vi.mock("server-only", () => ({}));

const { renderKioskBadgePdf } = await import("./badge-pdf");

const CREDENTIAL = "K8B0123456789ABCDEFGHJKMNPQRSTVWX0123456789ABCDEFGHJKMNP";

/** A playing camera preview of `width` × `height`. */
function playingVideo(width = 640, height = 480) {
	return { readyState: 4, videoWidth: width, videoHeight: height } as unknown as HTMLVideoElement;
}

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** An in-memory canvas whose frame is `frame`, recording what is drawn and cleared. */
function canvasShowing(frame: Pixels | null) {
	const drawn: unknown[] = [];
	const cleared: number[] = [];
	const canvas = {
		width: 0,
		height: 0,
		getContext: () =>
			frame
				? {
						drawImage: (source: unknown) => drawn.push(source),
						getImageData: (_x: number, _y: number, width: number, height: number) => {
							canvas.lastRead = { width, height };
							return frame;
						},
						clearRect: () => cleared.push(1),
					}
				: null,
		lastRead: null as { width: number; height: number } | null,
	};
	const document = { createElement: vi.fn(() => canvas) } as unknown as Document;
	return { canvas, document, drawn, cleared };
}

/** Nearest-neighbour downscale, as a lower-resolution camera would see the badge. */
function downscale(image: Pixels, width: number): Pixels {
	const height = Math.round((image.height * width) / image.width);
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const sx = Math.floor((x * image.width) / width);
			const sy = Math.floor((y * image.height) / height);
			const from = (sy * image.width + sx) * 4;
			data.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
		}
	}
	return { data, width, height };
}

describe("createKioskQrDecoder", () => {
	vi.setConfig({ testTimeout: 30_000 });

	it("uses the browser's barcode detector when it reads QR codes", async () => {
		const constructed: unknown[] = [];
		class FakeDetector {
			static getSupportedFormats = async () => ["ean_13", "qr_code"];
			constructor(options: unknown) {
				constructed.push(options);
			}
			detect = vi.fn(async () => [{ rawValue: CREDENTIAL }]);
		}
		const { document } = canvasShowing(null);

		const decoder = await createKioskQrDecoder({
			BarcodeDetector: FakeDetector as never,
			document,
		});

		expect(decoder).not.toBeNull();
		expect(constructed).toEqual([{ formats: ["qr_code"] }]);
		expect(await decoder?.read(playingVideo())).toBe(CREDENTIAL);
		// No canvas is made for the browser's own detector.
		expect(document.createElement).not.toHaveBeenCalled();
	});

	it("decodes a printed badge PDF's QR code from a drawn frame when the browser has no QR detector", async () => {
		const pdf = await renderKioskBadgePdf({
			employeeName: "Ada Lovelace",
			organizationName: "Analytical Engines",
			credential: CREDENTIAL,
			labels: { title: "Kiosk badge", instructions: "Cut it out." },
		});
		// A camera sees the badge smaller than the PDF renders it.
		const frame = downscale(pdfQrImage(pdf), 240);
		const NoQrDetector = { getSupportedFormats: async () => ["ean_13"] };
		const { document, drawn, cleared } = canvasShowing(frame);
		const video = playingVideo(frame.width, frame.height);

		const decoder = await createKioskQrDecoder({
			BarcodeDetector: NoQrDetector as never,
			document,
		});
		const read = await decoder?.read(video);

		expect(read).toBe(CREDENTIAL);
		expect(normalizeKioskBadgeCredential(read)).toBe(CREDENTIAL);
		expect(drawn).toEqual([video]);
		// The frame does not stay on the canvas.
		expect(cleared).toHaveLength(1);
	});

	it("reads nothing from a camera that shows no picture yet", async () => {
		const { document, drawn } = canvasShowing({
			data: new Uint8ClampedArray(4),
			width: 1,
			height: 1,
		});
		const decoder = await createKioskQrDecoder({ document });

		expect(
			await decoder?.read({ readyState: 1, videoWidth: 0, videoHeight: 0 } as HTMLVideoElement),
		).toBeNull();
		expect(drawn).toEqual([]);
	});

	it("draws large camera frames at a reduced size", async () => {
		const blank = new Uint8ClampedArray(640 * 360 * 4).fill(255);
		const { canvas, document } = canvasShowing({ data: blank, width: 640, height: 360 });
		const decoder = await createKioskQrDecoder({ document });

		expect(await decoder?.read(playingVideo(1920, 1080))).toBeNull();
		expect(canvas.lastRead).toEqual({ width: 640, height: 360 });
	});

	it("cannot scan without a QR detector or a 2D canvas", async () => {
		const { document } = canvasShowing(null);

		expect(await createKioskQrDecoder({ document })).toBeNull();
		expect(await createKioskQrDecoder({ document: undefined })).toBeNull();
	});
});
