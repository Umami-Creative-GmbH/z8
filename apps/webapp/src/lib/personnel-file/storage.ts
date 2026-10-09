import "server-only";
import { copyPrivateObject } from "@/lib/storage/export-s3-client";
import {
	deleteTravelExpenseReceiptObject,
	loadReceiptPreview,
	RECEIPT_PREVIEW_MIME_TYPE,
} from "@/lib/travel-expenses/receipt-preview";
import { deleteTusUpload, readUploadedReceipt } from "@/lib/travel-expenses/receipt-processing";
import {
	HEIC_REFUSAL_MESSAGE,
	isHeicMime,
	isPersonnelDocumentMime,
	PERSONNEL_DOCUMENT_MAX_BYTES,
} from "./document.types";
import { isPayslipBatchMime, PAYSLIP_BATCH_REFUSAL_MESSAGE } from "./payslip-batch.types";
import type { CopyPersonnelFileObject } from "./upload-ledger";

/**
 * Personnel file objects reuse the private receipt storage pipeline: the
 * finished TUS upload is read and sniffed by its real bytes, stored write-once
 * in the private bucket, previewed as a small WebP for images, and deleted
 * together with every preview version. Only the allowlist and the size limit
 * differ (PDF, JPEG, PNG, WebP up to 20 MB; HEIC refused with a hint).
 */

export function readUploadedPersonnelDocument(input: {
	tusFileKey: string;
	fileName: string | undefined;
}) {
	return readUploadedReceipt({
		...input,
		maxBytes: PERSONNEL_DOCUMENT_MAX_BYTES,
		isAllowedMime: isPersonnelDocumentMime,
		refusalFor: (mime) => (isHeicMime(mime) ? HEIC_REFUSAL_MESSAGE : null),
	});
}

/** A staged payslip batch file (#868): a PDF of up to 20 MB, checked by its real bytes. */
export function readUploadedPayslip(input: { tusFileKey: string; fileName: string | undefined }) {
	return readUploadedReceipt({
		...input,
		maxBytes: PERSONNEL_DOCUMENT_MAX_BYTES,
		isAllowedMime: isPayslipBatchMime,
		refusalFor: () => PAYSLIP_BATCH_REFUSAL_MESSAGE,
	});
}

export { deleteTusUpload };

/** Deletes a stored document object and every version of its preview. */
export const deletePersonnelDocumentObject = deleteTravelExpenseReceiptObject;

/** Copies a staged object to its document key on payslip batch confirmation (#868). */
export const copyPersonnelFileObject: CopyPersonnelFileObject = copyPrivateObject;

export const loadPersonnelDocumentPreview = loadReceiptPreview;
export const PERSONNEL_DOCUMENT_PREVIEW_MIME_TYPE = RECEIPT_PREVIEW_MIME_TYPE;
