export const ALLOWED_TRAVEL_EXPENSE_MIME_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/bmp",
	"image/tiff",
] as const;

const ALLOWED_TRAVEL_EXPENSE_MIME_SET = new Set<string>(ALLOWED_TRAVEL_EXPENSE_MIME_TYPES);

export function isAllowedTravelExpenseMime(mime: string): boolean {
	return ALLOWED_TRAVEL_EXPENSE_MIME_SET.has(mime.toLowerCase());
}

/** Organization-scoped private object storage, the only home of an attached receipt. */
export const TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER = "s3-private";
