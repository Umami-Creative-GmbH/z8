/**
 * CSV Export Utility
 *
 * Generates CSV files from structured data using Papa Parse.
 * Handles proper escaping of commas, quotes, and newlines.
 */

import Papa from "papaparse";
import { DateTime } from "luxon";

export type CsvHeader<T> = {
	key: keyof T;
	label: string;
};

/**
 * Generate CSV string from data array
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @returns CSV string with proper escaping
 */
export function generateCsv<T extends Record<string, any>>(
	data: T[],
	headers: CsvHeader<T>[],
): string {
	// Transform data to match header keys
	const transformedData = data.map((row) => {
		const transformedRow: Record<string, any> = {};
		for (const header of headers) {
			const value: any = row[header.key];
			// Handle nested objects and arrays
			if (value === null || value === undefined) {
				transformedRow[header.label] = "";
			} else if (value instanceof Date) {
				transformedRow[header.label] = value.toISOString();
			} else if (typeof value === "object") {
				transformedRow[header.label] = JSON.stringify(value);
			} else {
				transformedRow[header.label] = value;
			}
		}
		return transformedRow;
	});

	// Generate CSV using Papa Parse with proper escaping
	const csv = Papa.unparse(transformedData, {
		quotes: true, // Quote all fields for safety
		quoteChar: '"',
		escapeChar: '"',
		delimiter: ",",
		header: true,
		newline: "\r\n", // Windows-style line endings for Excel compatibility
	});

	return csv;
}

/**
 * Generate CSV Blob for download
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @returns Blob with CSV content and proper MIME type
 */
export function generateCsvBlob<T extends Record<string, any>>(
	data: T[],
	headers: CsvHeader<T>[],
): Blob {
	const csv = generateCsv(data, headers);
	return new Blob([csv], { type: "text/csv;charset=utf-8;" });
}

/**
 * Trigger CSV download in browser
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @param filename - Name of the file to download (without extension)
 */
export function downloadCsv<T extends Record<string, any>>(
	data: T[],
	headers: CsvHeader<T>[],
	filename: string,
): void {
	const blob = generateCsvBlob(data, headers);
	const url = window.URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${filename}.csv`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	window.URL.revokeObjectURL(url);
}
