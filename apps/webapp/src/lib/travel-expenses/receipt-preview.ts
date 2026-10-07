import "server-only";
import { createLogger } from "@/lib/logger";
import {
	deletePrivateObject,
	deletePrivateObjectVersions,
	privateObjectExists,
	readPrivateObject,
	uploadPrivateObject,
} from "@/lib/storage/export-s3-client";
import { isMissingObjectError } from "@/lib/storage/missing-object";
import { isTravelExpenseImageMime } from "./attachment-validation";

/**
 * Small previews of receipt images (#690). An expense tile shows a 64 px
 * thumbnail, so it loads this preview instead of the full original. Previews
 * are rendered on first use and kept in private storage next to their
 * write-once original; access is decided by whoever serves them. Deleting a
 * receipt object deletes its preview too, so this module owns both.
 */

const logger = createLogger("TravelExpenseReceiptPreview");

/** Edge of the square preview: the 64 px tile at up to 3x pixel density. */
export const RECEIPT_PREVIEW_SIZE = 192;
export const RECEIPT_PREVIEW_MIME_TYPE = "image/webp";

/** A stored receipt object as recorded on the receipt. */
interface ReceiptObject {
	organizationId: string;
	key: string;
	bucket: string | null;
	versionId: string | null;
}

/**
 * Renders the square, upright WebP preview of a receipt image, cropped like
 * the tile shows it. Null for a PDF or an image that cannot be read.
 */
export async function renderReceiptPreview(
	bytes: Uint8Array,
	mimeType: string,
): Promise<Uint8Array | null> {
	if (!isTravelExpenseImageMime(mimeType)) return null;
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

/** The stored preview, or null when none is stored yet (or it cannot be read). */
async function readStoredPreview(organizationId: string, key: string) {
	try {
		return await readPrivateObject({ organizationId, key, bucket: null, versionId: null });
	} catch (error) {
		if (!isMissingObjectError(error)) {
			logger.warn({ error, key }, "Failed to read receipt preview; rendering it again");
		}
		return null;
	}
}

/**
 * Stores a preview beside its original. Receipt deletion removes the original
 * before the preview, so a preview stored after that deletion finds the
 * original gone and removes itself instead of outliving the receipt.
 */
async function storePreview(original: ReceiptObject, key: string, bytes: Uint8Array) {
	try {
		await uploadPrivateObject(original.organizationId, key, bytes, RECEIPT_PREVIEW_MIME_TYPE);
		if (!(await privateObjectExists(original))) {
			await deletePrivateObjectVersions({
				organizationId: original.organizationId,
				key,
				bucket: original.bucket,
			});
		}
	} catch (error) {
		// Still served; the next request renders it again.
		logger.warn({ error, key }, "Failed to store receipt preview");
	}
}

/**
 * The stored preview of a receipt, rendered from the original on first use.
 * `readOriginal` must return the verified original. Null when the receipt has
 * no preview: a PDF, or an image that cannot be read (tried only once).
 */
export async function loadReceiptPreview(
	input: ReceiptObject & { mimeType: string; readOriginal: () => Promise<Uint8Array> },
): Promise<Uint8Array | null> {
	if (!isTravelExpenseImageMime(input.mimeType)) return null;
	const key = receiptPreviewKey(input.key);
	const stored = await readStoredPreview(input.organizationId, key);
	if (stored) return stored.byteLength > 0 ? stored : null;
	const preview = await renderReceiptPreview(await input.readOriginal(), input.mimeType);
	// An empty object records an image without a preview, so it is not rendered again.
	await storePreview(input, key, preview ?? new Uint8Array());
	return preview;
}

/**
 * Deletes a stored receipt object together with every version of its preview,
 * which is stored without a recorded version. The original goes first (see
 * `storePreview`); a failure keeps the cleanup work, and its retry deletes the
 * already deleted original again harmlessly.
 */
export async function deleteTravelExpenseReceiptObject(input: ReceiptObject): Promise<void> {
	await deletePrivateObject(input);
	await deletePrivateObjectVersions({
		organizationId: input.organizationId,
		key: receiptPreviewKey(input.key),
		bucket: input.bucket,
	});
}
