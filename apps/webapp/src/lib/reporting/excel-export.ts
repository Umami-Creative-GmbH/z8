/**
 * Excel Export Utility
 *
 * Generates Excel files (.xlsx) from structured data using the xlsx library.
 * Supports auto-sized columns and formatted headers.
 */

import * as XLSX from "xlsx";

export type ExcelHeader<T> = {
	key: keyof T;
	label: string;
	width?: number; // Optional column width in characters
};

/**
 * Generate Excel workbook from data array
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @param sheetName - Name of the worksheet (default: "Sheet1")
 * @returns XLSX Workbook object
 */
export function generateExcelWorkbook<T extends Record<string, any>>(
	data: T[],
	headers: ExcelHeader<T>[],
	sheetName: string = "Sheet1",
): XLSX.WorkBook {
	// Transform data to match header keys and labels
	const transformedData = data.map((row) => {
		const transformedRow: Record<string, any> = {};
		for (const header of headers) {
			const value = row[header.key];
			// Handle different data types
			if (value === null || value === undefined) {
				transformedRow[header.label] = "";
			} else if (value && typeof value === "object" && value.constructor === Date) {
				transformedRow[header.label] = value;
			} else if (typeof value === "boolean") {
				transformedRow[header.label] = value ? "Yes" : "No";
			} else if (typeof value === "object") {
				transformedRow[header.label] = JSON.stringify(value);
			} else {
				transformedRow[header.label] = value;
			}
		}
		return transformedRow;
	});

	// Create worksheet from data
	const worksheet = XLSX.utils.json_to_sheet(transformedData);

	// Auto-size columns based on content or specified width
	const columnWidths: XLSX.ColInfo[] = headers.map((header) => {
		if (header.width) {
			return { wch: header.width };
		}

		// Calculate max width from header label and data
		const headerWidth = header.label.length;
		const dataWidth = Math.max(
			...transformedData.map((row) => {
				const value = row[header.label];
				return value ? String(value).length : 0;
			}),
		);

		// Use the larger of header or data width, with a max of 50 characters
		const width = Math.min(Math.max(headerWidth, dataWidth) + 2, 50);
		return { wch: width };
	});

	worksheet["!cols"] = columnWidths;

	// Create workbook and add worksheet
	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

	return workbook;
}

/**
 * Generate Excel Buffer for API responses
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @param sheetName - Name of the worksheet (default: "Sheet1")
 * @returns Buffer with Excel file content
 */
export function generateExcelBuffer<T extends Record<string, any>>(
	data: T[],
	headers: ExcelHeader<T>[],
	sheetName: string = "Sheet1",
): Buffer {
	const workbook = generateExcelWorkbook(data, headers, sheetName);
	const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
	return buffer;
}

/**
 * Generate Excel Blob for download in browser
 * @param data - Array of objects to export
 * @param headers - Array of header definitions with keys and labels
 * @param sheetName - Name of the worksheet (default: "Sheet1")
 * @returns Blob with Excel file content and proper MIME type
 */
export function generateExcelBlob<T extends Record<string, any>>(
	data: T[],
	headers: ExcelHeader<T>[],
	sheetName: string = "Sheet1",
): Blob {
	const workbook = generateExcelWorkbook(data, headers, sheetName);
	const arrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
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
export function downloadExcel<T extends Record<string, any>>(
	data: T[],
	headers: ExcelHeader<T>[],
	filename: string,
	sheetName: string = "Sheet1",
): void {
	const blob = generateExcelBlob(data, headers, sheetName);
	const url = window.URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${filename}.xlsx`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	window.URL.revokeObjectURL(url);
}
