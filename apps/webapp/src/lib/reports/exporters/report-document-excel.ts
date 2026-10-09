/**
 * Excel export of a report document (modeled on `excel-exporter.ts`): a
 * summary sheet with the facts and notes, then one sheet per table.
 *
 * Money cells are written as numbers with two decimals so a spreadsheet can
 * sum them; they are converted from the exact two-decimal strings only here,
 * for display, after every calculation is done.
 */

import ExcelJS from "exceljs";
import type { ReportCell, ReportColumnKind, ReportDocument } from "./report-document";

const HEADER_FILL: ExcelJS.Fill = {
	type: "pattern",
	pattern: "solid",
	fgColor: { argb: "FF4472C4" },
};
const TOTAL_FILL: ExcelJS.Fill = {
	type: "pattern",
	pattern: "solid",
	fgColor: { argb: "FFE0E0E0" },
};

function sheetName(title: string, used: Set<string>): string {
	const base = title.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Sheet";
	let name = base;
	for (let index = 2; used.has(name.toLowerCase()); index += 1) {
		const suffix = ` ${index}`;
		name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
	}
	used.add(name.toLowerCase());
	return name;
}

function cellValue(cell: ReportCell, kind: ReportColumnKind, unknownLabel: string) {
	if (cell === null) return unknownLabel;
	if (kind === "money" && typeof cell === "string") return Number(cell);
	return cell;
}

const NUMBER_FORMATS: Partial<Record<ReportColumnKind, string>> = {
	money: "#,##0.00",
	hours: "0.00",
};

export async function exportReportDocumentToExcel(document: ReportDocument): Promise<Buffer> {
	const workbook = new ExcelJS.Workbook();
	workbook.creator = "Z8 Time Tracking";
	workbook.created = new Date();
	workbook.modified = new Date();
	const used = new Set<string>();

	const summary = workbook.addWorksheet(sheetName(document.title, used));
	summary.columns = [{ width: 32 }, { width: 40 }];
	const title = summary.addRow([document.title]);
	title.font = { size: 16, bold: true };
	summary.addRow([]);
	for (const fact of document.facts) summary.addRow([fact.label, fact.value]);
	if (document.notes.length > 0) {
		summary.addRow([]);
		for (const note of document.notes) summary.addRow([note]);
	}

	for (const table of document.tables) {
		const sheet = workbook.addWorksheet(sheetName(table.title, used));
		sheet.columns = table.columns.map((column) => ({
			header: column.header,
			key: column.key,
			width: Math.max(12, Math.min(40, column.header.length + 4)),
		}));
		const header = sheet.getRow(1);
		header.font = { color: { argb: "FFFFFFFF" }, bold: true };
		header.fill = HEADER_FILL;

		const addRow = (row: readonly ReportCell[]) => {
			const added = sheet.addRow(
				row.map((cell, index) =>
					cellValue(cell, table.columns[index]?.kind ?? "text", document.unknownLabel),
				),
			);
			table.columns.forEach((column, index) => {
				const format = NUMBER_FORMATS[column.kind];
				const cell = added.getCell(index + 1);
				if (format && typeof cell.value === "number") cell.numFmt = format;
			});
			return added;
		};
		for (const row of table.rows) addRow(row);
		if (table.totals) {
			const totals = addRow(table.totals);
			totals.font = { bold: true };
			totals.fill = TOTAL_FILL;
		}
	}

	const buffer = await workbook.xlsx.writeBuffer();
	return Buffer.from(buffer);
}
