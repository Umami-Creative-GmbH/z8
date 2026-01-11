/**
 * JSON Formatter for data export
 * Handles conversion of data to formatted JSON with metadata
 */

export interface ExportMetadata {
	exportedAt: string;
	organizationId: string;
	category: string;
	recordCount: number;
	version: string;
}

/**
 * Format data as pretty-printed JSON with metadata
 * @param data - Data to format
 * @param metadata - Export metadata
 * @returns Formatted JSON string
 */
export function toJSON(data: unknown, metadata: Partial<ExportMetadata>): string {
	const exportData = {
		_metadata: {
			exportedAt: new Date().toISOString(),
			version: "1.0",
			...metadata,
		},
		data,
	};

	return JSON.stringify(exportData, replacer, 2);
}

/**
 * JSON replacer function to handle special types
 */
function replacer(_key: string, value: unknown): unknown {
	// Handle Date objects
	if (value instanceof Date) {
		return value.toISOString();
	}

	// Handle BigInt
	if (typeof value === "bigint") {
		return value.toString();
	}

	// Handle undefined (convert to null for JSON compatibility)
	if (value === undefined) {
		return null;
	}

	return value;
}

/**
 * Count records in data structure
 */
export function countRecords(data: unknown): number {
	if (Array.isArray(data)) {
		return data.length;
	}

	if (typeof data === "object" && data !== null) {
		// For nested structures, count the main array properties
		let count = 0;
		for (const value of Object.values(data)) {
			if (Array.isArray(value)) {
				count += value.length;
			}
		}
		return count || 1;
	}

	return 1;
}

/**
 * Check if a category should be exported as JSON (structured data)
 */
export function isJSONCategory(category: string): boolean {
	return ["employees", "teams", "holidays", "vacation", "schedules"].includes(category);
}

/**
 * Category descriptions for metadata
 */
export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
	employees: "Employee profiles and manager relationships",
	teams: "Team structure and permissions",
	time_entries: "Time clock entries and corrections",
	work_periods: "Aggregated work sessions",
	absences: "Absence records and categories",
	holidays: "Holiday calendar and presets",
	vacation: "Vacation policies and allowances",
	schedules: "Work schedule templates and assignments",
	shifts: "Shift scheduling data",
	audit_logs: "Activity audit trail",
};
