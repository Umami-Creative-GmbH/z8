/**
 * Reporting Service
 *
 * Effect-based service for data export functionality.
 * Handles CSV and Excel report generation.
 */

import { Context, Data, Effect, Layer } from "effect";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { ExportHeader } from "@/lib/analytics/types";

export class ReportingError extends Data.TaggedError("ReportingError")<{
	message: string;
	details?: unknown;
}> {}

export class ReportingService extends Context.Tag("ReportingService")<
	ReportingService,
	{
		readonly exportToCsv: <T extends Record<string, unknown>>(
			data: T[],
			headers: ExportHeader<T>[],
			filename: string,
		) => Effect.Effect<string, ReportingError>;
		readonly exportToExcel: <T extends Record<string, unknown>>(
			data: T[],
			headers: ExportHeader<T>[],
			filename: string,
			sheetName?: string,
		) => Effect.Effect<Buffer, ReportingError>;
	}
>() {
	static readonly Live = Layer.succeed(ReportingService, {
		exportToCsv: <T extends Record<string, unknown>>(
			data: T[],
			headers: ExportHeader<T>[],
			filename: string,
		) =>
			Effect.gen(function* (_) {
				// Validate inputs
				if (!data || !Array.isArray(data)) {
					yield* _(
						Effect.fail(
							new ReportingError({
								message: "Data must be an array",
								details: { filename },
							}),
						),
					);
				}

				if (!headers || !Array.isArray(headers) || headers.length === 0) {
					yield* _(
						Effect.fail(
							new ReportingError({
								message: "Headers must be a non-empty array",
								details: { filename },
							}),
						),
					);
				}

				// Transform data to use header labels as keys
				const formattedData = data.map((row) => {
					const formattedRow: Record<string, unknown> = {};
					for (const header of headers) {
						formattedRow[header.label] = row[header.key];
					}
					return formattedRow;
				});

				// Generate CSV using papaparse
				try {
					const csv = Papa.unparse(formattedData, {
						quotes: true,
						quoteChar: '"',
						escapeChar: '"',
						delimiter: ",",
						header: true,
						newline: "\n",
					});

					if (!csv) throw new Error("Empty CSV generated");
					return csv;
				} catch (error) {
					return yield* _(
						Effect.fail(
							new ReportingError({
								message: "Failed to generate CSV",
								details: { filename, error: String(error) },
							}),
						),
					);
				}
			}),

		exportToExcel: <T extends Record<string, unknown>>(
			data: T[],
			headers: ExportHeader<T>[],
			filename: string,
			sheetName: string = "Sheet1",
		) =>
			Effect.gen(function* (_) {
				// Validate inputs
				if (!data || !Array.isArray(data)) {
					yield* _(
						Effect.fail(
							new ReportingError({
								message: "Data must be an array",
								details: { filename },
							}),
						),
					);
				}

				if (!headers || !Array.isArray(headers) || headers.length === 0) {
					yield* _(
						Effect.fail(
							new ReportingError({
								message: "Headers must be a non-empty array",
								details: { filename },
							}),
						),
					);
				}

				try {
					const workbook = new ExcelJS.Workbook();
					const worksheet = workbook.addWorksheet(sheetName);

					// Set up columns with headers and auto-sized widths
					worksheet.columns = headers.map((header) => {
						const headerLength = header.label.length;
						const maxDataLength = Math.max(
							0,
							...data.map((row) => {
								const value = row[header.key];
								return value ? String(value).length : 0;
							}),
						);
						return {
							header: header.label,
							key: String(header.key),
							width: Math.max(headerLength, maxDataLength, 10),
						};
					});

					// Style header row
					const headerRow = worksheet.getRow(1);
					headerRow.font = { bold: true };

					// Add data rows
					for (const row of data) {
						const rowData: Record<string, unknown> = {};
						for (const header of headers) {
							rowData[String(header.key)] = row[header.key] ?? "";
						}
						worksheet.addRow(rowData);
					}

					// Generate buffer
					const arrayBuffer = yield* _(
						Effect.tryPromise({
							try: () => workbook.xlsx.writeBuffer(),
							catch: (error) =>
								new ReportingError({
									message: "Failed to write Excel buffer",
									details: { filename, error: String(error) },
								}),
						}),
					);

					const buffer = Buffer.from(arrayBuffer);
					if (!buffer.length) throw new Error("Empty Excel buffer generated");
					return buffer;
				} catch (error) {
					return yield* _(
						Effect.fail(
							new ReportingError({
								message: "Failed to generate Excel file",
								details: { filename, error: String(error) },
							}),
						),
					);
				}
			}),
	});
}
