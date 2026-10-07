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

/** An image receipt, which has a preview; every other allowed receipt is a PDF. */
export function isTravelExpenseImageMime(mime: string): boolean {
	return mime.toLowerCase().startsWith("image/");
}

/** Organization-scoped private object storage, the only home of an attached receipt. */
export const TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER = "s3-private";
