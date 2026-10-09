import {
	HEIC_REFUSAL_MESSAGE,
	isHeicMime,
	PERSONNEL_DOCUMENT_MAX_BYTES,
	PERSONNEL_DOCUMENT_MIME_TYPES,
} from "@/lib/personnel-file/document.types";
import {
	PAYSLIP_BATCH_MIME_TYPES,
	PAYSLIP_BATCH_REFUSAL_MESSAGE,
} from "@/lib/personnel-file/payslip-batch.types";
import { ALLOWED_TRAVEL_EXPENSE_MIME_TYPES } from "@/lib/travel-expenses/attachment-validation";

/**
 * What a TUS upload is for, declared by the client in the `purpose` upload
 * metadata. Each purpose has its own MIME allowlist and size limit; uploads
 * without a purpose (receipts, avatars, logos) keep the receipt allowlist and
 * the configured default limit. The finalize route of each purpose re-checks
 * the real bytes, so this is only the early refusal.
 */
export const UPLOAD_PURPOSES = ["receipt", "personnel-document", "payslip-batch"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const UPLOAD_PURPOSE_METADATA_KEY = "purpose";

export interface UploadPolicy {
	mimeTypes: ReadonlySet<string>;
	maxBytes: number;
	/** A specific refusal for a declared type, or null to use the generic one. */
	refusalFor(mimeType: string): string | null;
}

export function isUploadPurpose(value: string): value is UploadPurpose {
	return (UPLOAD_PURPOSES as readonly string[]).includes(value);
}

export function uploadPolicyFor(
	purpose: UploadPurpose,
	options: { defaultMaxBytes: number },
): UploadPolicy {
	switch (purpose) {
		case "receipt":
			return {
				mimeTypes: new Set<string>(ALLOWED_TRAVEL_EXPENSE_MIME_TYPES),
				maxBytes: options.defaultMaxBytes,
				refusalFor: () => null,
			};
		case "personnel-document":
			return {
				mimeTypes: new Set<string>(PERSONNEL_DOCUMENT_MIME_TYPES),
				maxBytes: PERSONNEL_DOCUMENT_MAX_BYTES,
				refusalFor: (mimeType) => (isHeicMime(mimeType) ? HEIC_REFUSAL_MESSAGE : null),
			};
		case "payslip-batch":
			// Payslip batch files (#868): PDFs only, each up to the document limit.
			return {
				mimeTypes: new Set<string>(PAYSLIP_BATCH_MIME_TYPES),
				maxBytes: PERSONNEL_DOCUMENT_MAX_BYTES,
				refusalFor: () => PAYSLIP_BATCH_REFUSAL_MESSAGE,
			};
	}
}
