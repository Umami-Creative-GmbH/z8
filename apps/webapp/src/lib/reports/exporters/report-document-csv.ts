import { formatReportCell, type ReportCell, type ReportDocument } from "./report-document";

/**
 * CSV export of a report document (modeled on `csv-exporter.ts`): the facts as
 * label/value lines, then each table with its header and totals. Money stays
 * an exact two-decimal string; the currency is in the column header.
 */

function escapeCsv(value: string): string {
	if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

function line(values: readonly string[]): string {
	return values.map(escapeCsv).join(",");
}

export function exportReportDocumentToCSV(document: ReportDocument): string {
	const lines: string[] = [line([document.title]), ""];
	for (const fact of document.facts) lines.push(line([fact.label, fact.value]));

	for (const table of document.tables) {
		const cells = (row: readonly ReportCell[]) =>
			row.map((cell, index) =>
				formatReportCell(cell, table.columns[index]?.kind ?? "text", document.unknownLabel),
			);
		lines.push("", line([table.title]), line(table.columns.map((column) => column.header)));
		for (const row of table.rows) lines.push(line(cells(row)));
		if (table.totals) lines.push(line(cells(table.totals)));
	}

	if (document.notes.length > 0) {
		lines.push("");
		for (const note of document.notes) lines.push(line([note]));
	}
	return lines.join("\n");
}
