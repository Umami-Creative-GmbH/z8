/**
 * Excel Export Utility
 *
 * Generates Excel files (.xlsx) from structured data using ExcelJS.
 * Supports auto-sized columns and formatted headers.
 */

import ExcelJS from "exceljs";

export type ExcelHeader<T> = {
	key: keyof T;
	label: string;
	width?: number; // Optional column width in characters
};

/**
 * Transform a value for Excel cell
 */
function transformValue(value: unknown): string | number | boolean | Date {
	if (value === null || value === undefined) {
		return "";
	}
	if (value instanceof Date) {
		return value;
	}
	if (typeof value === "boolean") {
		return value ? "Yes" : "No";
	}
	if (typeof value === "object") {
		return JSON.stringify(value);
	}
	return value as string | number;
}

/**
 * Calculate column width based on content
 */
function calculateColumnWidth<T extends Record<string, unknown>>(
	header: ExcelHeader<T>,
	data: T[],
): number {
	if (header.width) {
		return header.width;
	}

	const headerWidth = header.label.length;
	const dataWidth = Math.max(
		0,
		...data.map((row) => {
			const value = row[header.key];
			return value ? String(value).length : 0;
		}),
	);

	// Use the larger of header or data width, with a max of 50 characters
	return Math.min(Math.max(headerWidth, dataWidth) + 2, 50);
}

/**
 * Generate Excel workbook from data array
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @param sheetName - Name of the worksheet (default: "Sheet1")
 * @returns ExcelJS Workbook object
 */
export function generateExcelWorkbook<T extends Record<string, unknown>>(
	data: T[],
	headers: ExcelHeader<T>[],
	sheetName: string = "Sheet1",
): ExcelJS.Workbook {
	const workbook = new ExcelJS.Workbook();
	const worksheet = workbook.addWorksheet(sheetName);

	// Set up columns with headers and widths
	worksheet.columns = headers.map((header) => ({
		header: header.label,
		key: String(header.key),
		width: calculateColumnWidth(header, data),
	}));

	// Style header row
	const headerRow = worksheet.getRow(1);
	headerRow.font = { bold: true };

	// Add data rows
	for (const row of data) {
		const rowData: Record<string, string | number | boolean | Date> = {};
		for (const header of headers) {
			rowData[String(header.key)] = transformValue(row[header.key]);
		}
		worksheet.addRow(rowData);
	}

	return workbook;
}

/**
 * Generate Excel Buffer for API responses
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @param sheetName - Name of the worksheet (default: "Sheet1")
 * @returns Promise<Buffer> with Excel file content
 */
export async function generateExcelBuffer<T extends Record<string, unknown>>(
	data: T[],
	headers: ExcelHeader<T>[],
	sheetName: string = "Sheet1",
): Promise<Buffer> {
	const workbook = generateExcelWorkbook(data, headers, sheetName);
	const arrayBuffer = await workbook.xlsx.writeBuffer();
	return Buffer.from(arrayBuffer);
}

/**
 * Generate Excel Blob for download in browser
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @param sheetName - Name of the worksheet (default: "Sheet1")
 * @returns Promise<Blob> with Excel file content and proper MIME type
 */
export async function generateExcelBlob<T extends Record<string, unknown>>(
	data: T[],
	headers: ExcelHeader<T>[],
	sheetName: string = "Sheet1",
): Promise<Blob> {
	const workbook = generateExcelWorkbook(data, headers, sheetName);
	const arrayBuffer = await workbook.xlsx.writeBuffer();
	return new Blob([arrayBuffer], {
		type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	});
}

/**
 * Trigger Excel download in browser
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @param filename - Name of the file to download (without extension)
 * @param sheetName - Name of the worksheet (default: "Sheet1")
 */
export async function downloadExcel<T extends Record<string, unknown>>(
	data: T[],
	headers: ExcelHeader<T>[],
	filename: string,
	sheetName: string = "Sheet1",
): Promise<void> {
	const blob = await generateExcelBlob(data, headers, sheetName);
	const url = window.URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${filename}.xlsx`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	window.URL.revokeObjectURL(url);
}
