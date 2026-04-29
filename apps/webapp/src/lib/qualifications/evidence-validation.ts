export const MAX_QUALIFICATION_EVIDENCE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_QUALIFICATION_EVIDENCE_MIME_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;

const ALLOWED_QUALIFICATION_EVIDENCE_MIME_TYPE_SET = new Set(
	ALLOWED_QUALIFICATION_EVIDENCE_MIME_TYPES,
);

export function isAllowedQualificationEvidenceMime(mimeType: string): boolean {
	return ALLOWED_QUALIFICATION_EVIDENCE_MIME_TYPE_SET.has(
		mimeType as (typeof ALLOWED_QUALIFICATION_EVIDENCE_MIME_TYPES)[number],
	);
}

export function sanitizeQualificationEvidenceFileName(fileName: string): string {
	const baseName = fileName.split(/[/\\]/).pop() ?? "qualification-evidence";
	const normalized = baseName
		.replace(/\s+/g, "-")
		.replace(/[^a-zA-Z0-9._-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^[-_.]+|[-_.]+$/g, "");

	return (normalized || "qualification-evidence").slice(0, 120);
}

export function isValidTusFileKey(key: string): boolean {
	return key.length > 0 && !key.includes("..") && !key.includes("/") && !key.includes("\\");
}
