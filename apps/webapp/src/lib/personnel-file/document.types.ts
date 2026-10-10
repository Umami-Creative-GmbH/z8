/**
 * Dependency-free vocabulary of the Personnel File context (CONTEXT.md). The
 * database schema, server code and client components all import it, so it
 * imports nothing.
 */

/** The fixed document categories, the same for every organization. */
export const DOCUMENT_CATEGORIES = [
	"contract",
	"payslip",
	"certificate",
	"sick_note",
	"other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** Shared documents are visible to the employee; HR-only documents are not. */
export const DOCUMENT_VISIBILITIES = ["shared", "hr_only"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

/** Only these categories may carry an expiry date. */
export const EXPIRY_DATE_CATEGORIES: readonly DocumentCategory[] = ["certificate", "other"];

/** The categories an employee may upload into their own file; always shared (#867). */
export const EMPLOYEE_UPLOAD_CATEGORIES: readonly DocumentCategory[] = ["certificate", "other"];

/** Visibility a new document of a category gets unless the uploader picks another. */
export const DEFAULT_VISIBILITY: Readonly<Record<DocumentCategory, DocumentVisibility>> = {
	contract: "shared",
	payslip: "shared",
	certificate: "shared",
	sick_note: "hr_only",
	other: "hr_only",
};

/** The month a payslip settles. */
export interface PayPeriod {
	year: number;
	/** 1-12 */
	month: number;
}

export function isDocumentCategory(value: unknown): value is DocumentCategory {
	return typeof value === "string" && (DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

export function isDocumentVisibility(value: unknown): value is DocumentVisibility {
	return typeof value === "string" && (DOCUMENT_VISIBILITIES as readonly string[]).includes(value);
}

/** File types an employee document may have. HEIC is refused (no conversion exists). */
export const PERSONNEL_DOCUMENT_MIME_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;

export const PERSONNEL_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Photo types the camera input asks for. Without `image/*`, iOS hands over a
 * JPEG instead of a HEIC photo (#983).
 */
export const SICK_NOTE_CAMERA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** At most this many sick notes are staged with one absence (#983). */
export const MAX_STAGED_SICK_NOTES = 10;

export function isPersonnelDocumentMime(mime: string): boolean {
	return (PERSONNEL_DOCUMENT_MIME_TYPES as readonly string[]).includes(mime.toLowerCase());
}

export function isHeicMime(mime: string): boolean {
	return /^image\/hei[cf](-sequence)?$/i.test(mime.trim());
}

/** Why a chosen file cannot become an employee document. */
export type PersonnelDocumentFileProblem = "heic" | "unsupported_type" | "too_large";

/** Checks a chosen file before uploading it; null when it may be uploaded. */
export function personnelDocumentFileProblem(file: {
	type: string;
	name: string;
	size: number;
}): PersonnelDocumentFileProblem | null {
	if (isHeicMime(file.type) || /\.hei[cf]$/i.test(file.name)) return "heic";
	if (!isPersonnelDocumentMime(file.type)) return "unsupported_type";
	if (file.size > PERSONNEL_DOCUMENT_MAX_BYTES) return "too_large";
	return null;
}

export const HEIC_REFUSAL_MESSAGE =
	"HEIC images are not supported. Export the photo as JPEG and upload it again.";

/** Staged uploads waiting for finalization, and stored objects waiting for deletion. */
export const PERSONNEL_FILE_UPLOAD_STATUSES = ["pending", "cleanup_required"] as const;
export type PersonnelFileUploadStatus = (typeof PERSONNEL_FILE_UPLOAD_STATUSES)[number];

export const PERSONNEL_FILE_CLEANUP_REASONS = [
	"finalization_failed",
	"abandoned",
	"removed",
] as const;
export type PersonnelFileCleanupReason = (typeof PERSONNEL_FILE_CLEANUP_REASONS)[number];
