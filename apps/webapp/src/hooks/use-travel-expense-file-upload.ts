"use client";

import { ALLOWED_TRAVEL_EXPENSE_MIME_TYPES } from "@/lib/travel-expenses/attachment-validation";
import {
	type UseTusFileUploadOptions,
	type UseTusFileUploadReturn,
	useTusFileUpload,
} from "./use-tus-file-upload";

const DEFAULT_MAX_TRAVEL_EXPENSE_FILE_SIZE = 10 * 1024 * 1024;

/**
 * `useTusFileUpload` for receipts: receipt types and 10 MB by default.
 */
export function useTravelExpenseFileUpload<Result>({
	maxFileSize = DEFAULT_MAX_TRAVEL_EXPENSE_FILE_SIZE,
	allowedFileTypes = ALLOWED_TRAVEL_EXPENSE_MIME_TYPES,
	...options
}: Omit<UseTusFileUploadOptions<Result>, "maxFileSize" | "allowedFileTypes"> &
	Partial<
		Pick<UseTusFileUploadOptions<Result>, "maxFileSize" | "allowedFileTypes">
	>): UseTusFileUploadReturn {
	return useTusFileUpload({ ...options, maxFileSize, allowedFileTypes });
}
