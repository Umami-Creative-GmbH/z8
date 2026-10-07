import "server-only";
import { createLogger } from "@/lib/logger";
import {
	deletePrivateObject,
	deletePrivateObjectVersions,
	readPrivateObject,
	uploadPrivateObject,
} from "@/lib/storage/export-s3-client";

/**
 * Small previews of receipt images (#690). An expense tile shows a 64 px
 * thumbnail, so it loads this preview instead of the full original. Previews
 * are rendered on first use and kept in private storage next to their
 * write-once original; access is decided by whoever serves them.
 */

const logger = createLogger("TravelExpenseReceiptPreview");

/** Edge of the square preview: the 64 px tile at up to 3x pixel density. */
export const RECEIPT_PREVIEW_SIZE = 192;
export const RECEIPT_PREVIEW_MIME_TYPE = "image/webp";

/**
 * Renders the square, upright WebP preview of a receipt image, cropped like
 * the tile shows it. Null for a PDF or an image that cannot be read.
 */
export async function renderReceiptPreview(
	bytes: Uint8Array,
	mimeType: string,
): Promise<Uint8Array | null> {
	if (!mimeType.startsWith("image/")) return null;
	try {
		const sharp = (await import("sharp")).default;
		const preview = await sharp(bytes)
			.autoOrient()
			.resize(RECEIPT_PREVIEW_SIZE, RECEIPT_PREVIEW_SIZE, { fit: "cover" })
			.webp({ quality: 70 })
			.toBuffer();
		return new Uint8Array(preview);
	} catch {
		return null;
	}
}

/** The original's key is write-once, so the preview stored beside it always matches it. */
function receiptPreviewKey(storageKey: string) {
	return `${storageKey}.preview-${RECEIPT_PREVIEW_SIZE}.webp`;
}

/**
 * The stored preview of a receipt, rendered from the original on first use.
 * `readOriginal` must return the verified original. Null when the receipt has
 * no preview (a PDF, or an image that cannot be read).
 */
export async function loadReceiptPreview(input: {
	organizationId: string;
	key: string;
	mimeType: string;
	readOriginal: () => Promise<Uint8Array>;
}): Promise<Uint8Array | null> {
	if (!input.mimeType.startsWith("image/")) return null;
	const key = receiptPreviewKey(input.key);
	try {
		return await readPrivateObject({
			organizationId: input.organizationId,
			key,
			bucket: null,
			versionId: null,
		});
	} catch {
		// Not rendered yet (or unreadable): render it from the original below.
	}
	const preview = await renderReceiptPreview(await input.readOriginal(), input.mimeType);
	if (!preview) return null;
	try {
		await uploadPrivateObject(input.organizationId, key, preview, RECEIPT_PREVIEW_MIME_TYPE);
	} catch (error) {
		// Still served; the next request renders it again.
		logger.warn({ error, key }, "Failed to store receipt preview");
	}
	return preview;
}

/**
 * Deletes a stored receipt object together with every version of its preview,
 * which is stored without a recorded version. The preview goes first, so a
 * failure keeps the original and its cleanup work for a retry.
 */
export async function deleteTravelExpenseReceiptObject(input: {
	organizationId: string;
	key: string;
	bucket: string | null;
	versionId: string | null;
}): Promise<void> {
	await deletePrivateObjectVersions({
		organizationId: input.organizationId,
		key: receiptPreviewKey(input.key),
		bucket: input.bucket,
	});
	await deletePrivateObject(input);
}
