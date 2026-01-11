/**
 * CSV Formatter for data export
 * Handles conversion of arrays of objects to CSV format
 */

/**
 * Escape a value for CSV format
 */
function escapeCSV(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}

	let str = String(value);

	// If the value contains special characters, wrap in quotes and escape internal quotes
	if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
		str = `"${str.replace(/"/g, '""')}"`;
	}

	return str;
}

/**
 * Format a date value for CSV
 */
function formatDate(value: unknown): string {
	if (!value) return "";

	if (value instanceof Date) {
		return value.toISOString();
	}

	// If it's a string that looks like a date, try to parse it
	if (typeof value === "string") {
		const date = new Date(value);
		if (!isNaN(date.getTime())) {
			return date.toISOString();
		}
	}

	return String(value);
}

/**
 * Get all unique keys from an array of objects
 */
function getAllKeys(data: Record<string, unknown>[]): string[] {
	const keysSet = new Set<string>();

	for (const item of data) {
		for (const key of Object.keys(item)) {
			keysSet.add(key);
		}
	}

	return Array.from(keysSet);
}

/**
 * Convert an array of objects to CSV format
 * @param data - Array of objects to convert
 * @param columns - Optional specific columns to include (in order)
 * @returns CSV string with header row
 */
export function toCSV(data: Record<string, unknown>[], columns?: string[]): string {
	if (!data || data.length === 0) {
		return "";
	}

	// Determine columns to use
	const headers = columns || getAllKeys(data);

	// Build header row
	const headerRow = headers.map(escapeCSV).join(",");

	// Build data rows
	const dataRows = data.map((item) => {
		return headers
			.map((key) => {
				const value = item[key];

				// Handle date fields
				if (
					key.toLowerCase().includes("date") ||
					key.toLowerCase().includes("time") ||
					key.toLowerCase().includes("at") ||
					key === "timestamp"
				) {
					return escapeCSV(formatDate(value));
				}

				// Handle JSON objects/arrays
				if (typeof value === "object" && value !== null) {
					return escapeCSV(JSON.stringify(value));
				}

				return escapeCSV(value);
			})
			.join(",");
	});

	return [headerRow, ...dataRows].join("\n");
}

/**
 * Column definitions for different export types
 */
export const CSV_COLUMNS = {
	time_entries: [
		"id",
		"employeeId",
		"employeeName",
		"employeeNumber",
		"type",
		"timestamp",
		"notes",
		"location",
		"deviceInfo",
		"replacesEntryId",
		"isSuperseded",
		"createdAt",
	],
	work_periods: [
		"id",
		"employeeId",
		"employeeName",
		"employeeNumber",
		"startTime",
		"endTime",
		"durationMinutes",
		"isActive",
		"clockInId",
		"clockOutId",
		"createdAt",
	],
	absences: [
		"id",
		"employeeId",
		"employeeName",
		"employeeNumber",
		"categoryId",
		"categoryName",
		"absenceType",
		"startDate",
		"endDate",
		"status",
		"notes",
		"approvedBy",
		"approvedAt",
		"rejectionReason",
		"createdAt",
	],
	shifts: [
		"id",
		"templateId",
		"templateName",
		"employeeId",
		"employeeName",
		"date",
		"startTime",
		"endTime",
		"status",
		"publishedAt",
		"notes",
	],
	audit_logs: [
		"id",
		"entityType",
		"entityId",
		"action",
		"performedBy",
		"changes",
		"metadata",
		"timestamp",
	],
};

/**
 * Check if a category should be exported as CSV (large volume data)
 */
export function isCSVCategory(category: string): boolean {
	return ["time_entries", "work_periods", "absences", "shifts", "audit_logs"].includes(category);
}
