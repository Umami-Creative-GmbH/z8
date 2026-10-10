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
	// A number in a column whose name merely contains "at" (positionLatitude) is no date; 0 is a value.
	if (typeof value === "number") return String(value);
	if (!value) return "";

	if (value instanceof Date) {
		return value.toISOString();
	}

	// If it's a string that looks like a date, try to parse it
	if (typeof value === "string") {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
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

/** A column of a CSV table dataset: the row key it reads and the header it shows. */
export interface CsvTableColumn {
	key: string;
	header: string;
}

/**
 * A dataset that brings its own columns (#820: projects and customers, whose
 * custom field columns depend on the organization and the requester).
 *
 * Unlike `toCSV`, a table never guesses dates from column names: a `Date`
 * value is written as an ISO instant, everything else as it is. So a custom
 * field named "Start date" keeps its ISO calendar date ("2024-02-29"), and a
 * text such as a VAT ID "2024" is never read as a year.
 */
export interface CsvTable {
	format: "csv-table";
	columns: CsvTableColumn[];
	rows: Record<string, unknown>[];
}

export function isCsvTable(data: unknown): data is CsvTable {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as { format?: unknown }).format === "csv-table"
	);
}

/** A CSV table with its header row, also when it has no rows. */
export function csvTableToCSV(table: CsvTable): string {
	const cell = (value: unknown) => {
		if (value instanceof Date) return escapeCSV(value.toISOString());
		if (typeof value === "object" && value !== null) return escapeCSV(JSON.stringify(value));
		return escapeCSV(value);
	};
	return [
		table.columns.map((column) => escapeCSV(column.header)).join(","),
		...table.rows.map((row) => table.columns.map((column) => cell(row[column.key])).join(",")),
	].join("\n");
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
		// Appended last so readers of the older column order keep working (#876).
		// Key names must avoid "date", "time" and "at", which toCSV treats as dates.
		"projectId",
		"projectName",
		"taskId",
		"taskName",
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
 * The position stamp columns (#835, spec #766) of a time entry row. They exist
 * only when the requesting user may view everyone's position stamps; otherwise
 * the rows carry none of these keys and the file has no position column.
 */
export const TIME_ENTRY_POSITION_COLUMNS = [
	"positionLatitude",
	"positionLongitude",
	"positionAccuracyMeters",
	"positionFixedAt",
] as const;

/** The time entries file's columns: the position stamp columns sit where `location` was. */
export function timeEntryCsvColumns(rows: readonly Record<string, unknown>[]): string[] {
	const columns = [...CSV_COLUMNS.time_entries];
	if (!rows.some((row) => TIME_ENTRY_POSITION_COLUMNS[0] in row)) return columns;
	columns.splice(columns.indexOf("notes") + 1, 0, ...TIME_ENTRY_POSITION_COLUMNS);
	return columns;
}

/**
 * Check if a category should be exported as CSV (large volume data)
 */
export function isCSVCategory(category: string): boolean {
	return [
		"time_entries",
		"work_periods",
		"absences",
		"balance_adjustments",
		"shifts",
		"audit_logs",
		"projects",
		"customers",
	].includes(category);
}
