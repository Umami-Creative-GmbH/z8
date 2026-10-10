import Papa from "papaparse";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

/**
 * The CSV file of the bulk opening balance upload (#999). Pure and shared by
 * the server, which parses the uploaded text authoritatively, and the client,
 * which offers the template.
 *
 * Columns, in any order, with a header row: `employee_number`, `day`,
 * `balance`, `reason`. Header names ignore case, surrounding spaces, and
 * spaces or hyphens instead of underscores; other columns are ignored.
 * The delimiter is a comma, a semicolon or a tab (spreadsheets in German
 * write semicolons), taken from the header row; an Excel `sep=` line is
 * honoured. A UTF-8 byte order mark is ignored.
 *
 * - `day`: the day the opening balance is dated, as `YYYY-MM-DD` or
 *   `DD.MM.YYYY` (spreadsheets rewrite ISO dates in German locales).
 * - `balance`: signed hours and minutes, `H:MM` (`12:30`, `-8:05`, `+0:45`);
 *   a trailing `:00` (seconds added by a spreadsheet) is accepted.
 * - `reason`: required, at most 1000 characters.
 *
 * Rows whose cells are all blank are skipped. `row` is the spreadsheet row
 * number, counting the header as row 1.
 */

export const OPENING_BALANCE_CSV_COLUMNS = ["employee_number", "day", "balance", "reason"] as const;

export type OpeningBalanceCsvColumn = (typeof OPENING_BALANCE_CSV_COLUMNS)[number];

/** Rows per file: keeps one upload within one transaction and one request. */
export const MAX_OPENING_BALANCE_UPLOAD_ROWS = 2000;

/** Characters per file (the server action body limit is 1 MB). */
export const MAX_OPENING_BALANCE_UPLOAD_CHARACTERS = 500_000;

const MAX_REASON_LENGTH = 1000;

/** What is wrong with a row's own cells, before any employee is looked up. */
export type OpeningBalanceCsvRowErrorCode =
	| "employee_number_required"
	| "invalid_day"
	| "invalid_amount"
	| "reason_required"
	| "reason_too_long";

export type OpeningBalanceCsvRow = {
	/** Spreadsheet row number; the header is row 1. */
	row: number;
	employeeNumber: string;
	/** `YYYY-MM-DD`, or null when the cell is not a valid day. */
	day: string | null;
	/** Signed minutes, or null when the cell is not a valid balance. */
	minutes: number | null;
	reason: string;
	errors: OpeningBalanceCsvRowErrorCode[];
};

/** Why the whole file was refused. */
export type OpeningBalanceCsvFileErrorCode =
	| "file_too_large"
	| "no_rows"
	| "missing_columns"
	| "too_many_rows";

export type OpeningBalanceCsvParseResult =
	| { ok: true; rows: OpeningBalanceCsvRow[] }
	| {
			ok: false;
			code: OpeningBalanceCsvFileErrorCode;
			/** With `missing_columns`. */
			missingColumns?: OpeningBalanceCsvColumn[];
	  };

const BALANCE = /^([+\-−])?(\d{1,5}):([0-5]\d)(?::00)?$/u;
const GERMAN_DAY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u;

/** A `balance` cell in signed minutes, or null. */
export function parseOpeningBalanceAmount(value: string): number | null {
	const match = BALANCE.exec(value.replace(/\s+/gu, ""));
	if (!match) return null;
	const magnitude = Number(match[2]) * 60 + Number(match[3]);
	return match[1] && match[1] !== "+" && magnitude !== 0 ? -magnitude : magnitude;
}

/** A `day` cell as `YYYY-MM-DD`, or null. */
export function parseOpeningBalanceDay(value: string): string | null {
	const trimmed = value.trim();
	const german = GERMAN_DAY.exec(trimmed);
	const iso = german
		? `${german[3]}-${german[2]?.padStart(2, "0")}-${german[1]?.padStart(2, "0")}`
		: trimmed;
	try {
		return parsePlainDate(iso).toString();
	} catch {
		return null;
	}
}

function normalizeHeader(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/gu, "_");
}

function detectDelimiter(headerLine: string): string {
	const counts = [",", ";", "\t"].map((delimiter) => ({
		delimiter,
		count: headerLine.split(delimiter).length - 1,
	}));
	counts.sort((left, right) => right.count - left.count);
	return counts[0]?.count ? (counts[0].delimiter as string) : ",";
}

export function parseOpeningBalanceCsv(text: string): OpeningBalanceCsvParseResult {
	if (text.length > MAX_OPENING_BALANCE_UPLOAD_CHARACTERS)
		return { ok: false, code: "file_too_large" };
	let content = text.replace(/^﻿/u, "");
	let delimiter: string | null = null;
	const separatorLine = /^sep=(.)\r?\n/iu.exec(content);
	if (separatorLine) {
		delimiter = separatorLine[1] as string;
		content = content.slice(separatorLine[0].length);
	}
	const headerLine = content.split(/\r?\n/u, 1)[0] ?? "";
	delimiter ??= detectDelimiter(headerLine);

	const parsed = Papa.parse<string[]>(content, { delimiter, skipEmptyLines: false });
	const [header, ...records] = parsed.data;
	if (!header || header.every((cell) => !cell.trim())) return { ok: false, code: "no_rows" };

	const columns = header.map(normalizeHeader);
	const missingColumns = OPENING_BALANCE_CSV_COLUMNS.filter((column) => !columns.includes(column));
	if (missingColumns.length > 0) return { ok: false, code: "missing_columns", missingColumns };
	const index = Object.fromEntries(
		OPENING_BALANCE_CSV_COLUMNS.map((column) => [column, columns.indexOf(column)]),
	) as Record<OpeningBalanceCsvColumn, number>;

	// The header is row 1; spreadsheets hide a `sep=` line.
	const rowOffset = 2;
	const rows: OpeningBalanceCsvRow[] = [];
	for (const [position, record] of records.entries()) {
		if (record.every((cell) => !cell.trim())) continue;
		if (rows.length === MAX_OPENING_BALANCE_UPLOAD_ROWS)
			return { ok: false, code: "too_many_rows" };
		const cell = (column: OpeningBalanceCsvColumn) => record[index[column]] ?? "";
		const employeeNumber = cell("employee_number").trim();
		const day = parseOpeningBalanceDay(cell("day"));
		const minutes = parseOpeningBalanceAmount(cell("balance"));
		const reason = cell("reason").trim();
		const errors: OpeningBalanceCsvRowErrorCode[] = [];
		if (!employeeNumber) errors.push("employee_number_required");
		if (day === null) errors.push("invalid_day");
		if (minutes === null) errors.push("invalid_amount");
		if (!reason) errors.push("reason_required");
		else if (reason.length > MAX_REASON_LENGTH) errors.push("reason_too_long");
		rows.push({ row: position + rowOffset, employeeNumber, day, minutes, reason, errors });
	}
	if (rows.length === 0) return { ok: false, code: "no_rows" };
	return { ok: true, rows };
}

/** The downloadable template: the header and two example rows. */
export function openingBalanceCsvTemplate(): string {
	return `${Papa.unparse(
		{
			fields: [...OPENING_BALANCE_CSV_COLUMNS],
			data: [
				["1001", "2025-12-31", "12:30", "Balance carried over from the previous system"],
				["1002", "2025-12-31", "-4:15", "Hours owed, carried over from the previous system"],
			],
		},
		{ newline: "\r\n" },
	)}\r\n`;
}
