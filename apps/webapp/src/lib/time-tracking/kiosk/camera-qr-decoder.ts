/**
 * Reads QR codes from the kiosk camera's live preview, on the device (#1367,
 * spec #889). The browser's own `BarcodeDetector` when it reads QR codes
 * (Chrome on Android and ChromeOS, for example); otherwise each frame is drawn
 * on an in-memory canvas that is never attached to the page and decoded with
 * `jsqr`, loaded only then. A frame is read and dropped at once: nothing is
 * kept, uploaded or attached to anything; only the decoded text leaves here.
 */

/** Reads the QR code in the camera preview's current frame, or null when it sees none. */
export interface KioskQrDecoder {
	read(video: HTMLVideoElement): Promise<string | null>;
}

/** The part of the Barcode Detection API the kiosk uses (not yet in TypeScript's DOM types). */
type BarcodeDetectorLike = {
	detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
};
type BarcodeDetectorConstructor = {
	new (options: { formats: string[] }): BarcodeDetectorLike;
	getSupportedFormats?: () => Promise<string[]>;
};

/** What the decoder uses of the browser; tests pass their own. */
export type KioskQrDecoderEnvironment = {
	BarcodeDetector?: BarcodeDetectorConstructor;
	document?: Pick<Document, "createElement">;
};

/** Frames are decoded at most this wide: enough for a badge held to the camera, and fast. */
const MAX_FRAME_WIDTH = 640;
/** `HTMLMediaElement.HAVE_CURRENT_DATA`: the preview shows a picture. */
const HAVE_CURRENT_DATA = 2;

function showsPicture(video: HTMLVideoElement) {
	return video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
}

async function nativeDecoder(
	Detector: BarcodeDetectorConstructor | undefined,
): Promise<KioskQrDecoder | null> {
	if (!Detector) return null;
	try {
		const formats = (await Detector.getSupportedFormats?.()) ?? [];
		if (!formats.includes("qr_code")) return null;
		const detector = new Detector({ formats: ["qr_code"] });
		return {
			async read(video) {
				if (!showsPicture(video)) return null;
				const [code] = await detector.detect(video).catch(() => []);
				return code?.rawValue ?? null;
			},
		};
	} catch {
		return null;
	}
}

async function canvasDecoder(
	document: KioskQrDecoderEnvironment["document"],
): Promise<KioskQrDecoder | null> {
	const canvas = document?.createElement("canvas");
	const context = canvas?.getContext("2d", { willReadFrequently: true });
	if (!canvas || !context) return null;
	const { default: jsQR } = await import("jsqr");
	return {
		async read(video) {
			if (!showsPicture(video)) return null;
			const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
			const width = Math.max(1, Math.round(video.videoWidth * scale));
			const height = Math.max(1, Math.round(video.videoHeight * scale));
			canvas.width = width;
			canvas.height = height;
			context.drawImage(video, 0, 0, width, height);
			const frame = context.getImageData(0, 0, width, height);
			context.clearRect(0, 0, width, height);
			return jsQR(frame.data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null;
		},
	};
}

/**
 * The best QR decoder this browser offers, or null when it can scan none (no
 * QR-capable `BarcodeDetector` and no 2D canvas): the kiosk then says that
 * live scanning is not supported.
 */
export async function createKioskQrDecoder(
	environment: KioskQrDecoderEnvironment = {
		BarcodeDetector: (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
			.BarcodeDetector,
		document: globalThis.document,
	},
): Promise<KioskQrDecoder | null> {
	return (
		(await nativeDecoder(environment.BarcodeDetector)) ??
		(await canvasDecoder(environment.document))
	);
}
