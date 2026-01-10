/**
 * Reporting Service
 *
 * Effect-based service for data export functionality.
 * Handles CSV and Excel report generation.
 */

import { Context, Data, Effect, Layer } from "effect";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ExportHeader } from "@/lib/analytics/types";

// Since ValidationError is Data.TaggedError("ValidationError"), extending it directly isn't the best if we want a new tag.
// But if we want to alias it, we can create a new class.

export class ReportingError extends Data.TaggedError("ReportingError")<{
	message: string;
	details?: unknown;
}> {}

export class ReportingService extends Context.Tag("ReportingService")<
	ReportingService,
	{
		readonly exportToCsv: <T extends Record<string, any>>(
			data: T[],
			headers: ExportHeader<T>[],
			filename: string,
		) => Effect.Effect<string, ReportingError>;
		readonly exportToExcel: <T extends Record<string, any>>(
			data: T[],
			headers: ExportHeader<T>[],
			filename: string,
			sheetName?: string,
		) => Effect.Effect<Buffer, ReportingError>;
	}
>() {
	static readonly Live = Layer.succeed(ReportingService, {
		exportToCsv: <T extends Record<string, any>>(
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
					const formattedRow: Record<string, any> = {};
					headers.forEach((header) => {
						formattedRow[header.label] = row[header.key];
					});
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

		exportToExcel: <T extends Record<string, any>>(
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

				// Transform data to use header labels as keys
				const formattedData = data.map((row) => {
					const formattedRow: Record<string, any> = {};
					headers.forEach((header) => {
						formattedRow[header.label] = row[header.key];
					});
					return formattedRow;
				});

				try {
					// Create worksheet from data
					const worksheet = XLSX.utils.json_to_sheet(formattedData);

					// Auto-size columns based on header and data
					const columnWidths = headers.map((header) => {
						const headerLength = header.label.length;
						const maxDataLength = Math.max(
							...formattedData.map((row) => {
								const value = row[header.label];
								return value ? String(value).length : 0;
							}),
						);
						return { wch: Math.max(headerLength, maxDataLength, 10) };
					});

					worksheet["!cols"] = columnWidths;

					// Create workbook
					const workbook = XLSX.utils.book_new();
					XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

					// Generate buffer
					const buffer = XLSX.write(workbook, {
						type: "buffer",
						bookType: "xlsx",
					}) as Buffer;

					if (!buffer) throw new Error("Empty Excel buffer generated");
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
