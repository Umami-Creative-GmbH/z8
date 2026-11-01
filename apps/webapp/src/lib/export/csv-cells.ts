/**
 * Formula-safe CSV cells, shared by exports a spreadsheet may open (travel
 * expenses #613, billable time reconciliation #1504). Text is always quoted
 * and formula-like text is prefixed with an apostrophe, because quoting alone
 * does not stop a spreadsheet from running it. Money is a validated signed
 * decimal written unquoted, so a negative amount stays a number. Files are
 * UTF-8 with a byte order mark and CRLF line endings (RFC 4180).
 */

/**
 * Leading characters spreadsheets treat as a formula (also after leading
 * whitespace), a leading tab or carriage return, and their full-width forms.
 */
const FORMULA_PREFIX = /^(?:[\t\r]|[\s]*[=+\-@＝＋－＠])/;
const SIGNED_DECIMAL = /^-?\d{1,12}\.\d{2}$/;
const BOM = "﻿";

/** A quoted text cell; formula-like text is prefixed with an apostrophe. */
export function csvText(value: string | number | null | undefined): string {
	const raw = value == null ? "" : String(value);
	const safe = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
	return `"${safe.replaceAll('"', '""')}"`;
}

/** A signed decimal with two places (a stored amount), safe to write unquoted. */
export function isCsvDecimal(value: string): boolean {
	return SIGNED_DECIMAL.test(value);
}

/** The file: a quoted header, then the rows of already written cells. */
export function csvFile(header: readonly string[], rows: readonly (readonly string[])[]): string {
	const lines = [header.map(csvText).join(","), ...rows.map((row) => row.join(","))];
	return `${BOM}${lines.join("\r\n")}\r\n`;
}
