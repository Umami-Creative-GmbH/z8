/**
 * Format file size for display
 * This is a client-safe utility function
 */
export function formatFileSize(bytes: number | null): string {
	if (bytes === null || bytes === 0) return "0 B";

	const units = ["B", "KB", "MB", "GB"];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * Export record type definition
 * Shared between client and server components
 */
export interface ExportRecord {
	id: string;
	organizationId: string;
	requestedById: string;
	categories: string[];
	status: "pending" | "processing" | "completed" | "failed";
	errorMessage: string | null;
	s3Key: string | null;
	fileSizeBytes: number | null;
	createdAt: Date;
	completedAt: Date | null;
	expiresAt: Date | null;
}
