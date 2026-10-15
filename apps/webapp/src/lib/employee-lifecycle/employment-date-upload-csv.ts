import Papa from "papaparse";
import { parseOpeningBalanceDay } from "@/lib/work-balance/adjustments/opening-balance-csv";

export const EMPLOYMENT_DATE_UPLOAD_COLUMNS = [
	"employee_number",
	"employment_start_date",
	"reason",
] as const;
export const MAX_EMPLOYMENT_DATE_UPLOAD_CHARACTERS = 500_000;
export const MAX_EMPLOYMENT_DATE_UPLOAD_ROWS = 200;
export type EmploymentDateCsvError =
	| "employee_number_required"
	| "invalid_date"
	| "reason_required"
	| "reason_too_long";
export interface EmploymentDateCsvRow {
	row: number;
	employeeNumber: string;
	employmentStartDate: string | null;
	suppliedEmploymentStartDate: string;
	reason: string;
	errors: EmploymentDateCsvError[];
}
export type EmploymentDateCsvResult =
	| { ok: true; rows: EmploymentDateCsvRow[] }
	| {
			ok: false;
			code: "file_too_large" | "too_many_rows" | "missing_columns" | "no_rows" | "malformed_csv";
			missingColumns?: string[];
	  };
/** Mirrors the established opening-balance upload format; dates use the shared spreadsheet calendar parser. */
export function parseEmploymentDateUploadCsv(text: string): EmploymentDateCsvResult {
	if (text.length > MAX_EMPLOYMENT_DATE_UPLOAD_CHARACTERS)
		return { ok: false, code: "file_too_large" };
	let content = text.replace(/^\uFEFF/u, "");
	const separator = /^sep=([,;\t])\r?\n/iu.exec(content);
	if (separator) content = content.slice(separator[0].length);
	const headerLine = content.split(/\r?\n/u, 1)[0] ?? "";
	const delimiter =
		separator?.[1] ??
		[",", ";", "\t"]
			.map((value) => ({ value, count: headerLine.split(value).length - 1 }))
			.sort((a, b) => b.count - a.count)[0]?.value ??
		",";
	const parsed = Papa.parse<string[]>(content, { delimiter, skipEmptyLines: false });
	if (parsed.errors.length) return { ok: false, code: "malformed_csv" };
	const [header, ...records] = parsed.data;
	if (!header || header.every((cell) => !cell.trim())) return { ok: false, code: "no_rows" };
	const columns = header.map((cell) =>
		cell
			.trim()
			.toLowerCase()
			.replace(/[\s-]+/gu, "_"),
	);
	const missingColumns = EMPLOYMENT_DATE_UPLOAD_COLUMNS.filter(
		(column) => !columns.includes(column),
	);
	if (missingColumns.length) return { ok: false, code: "missing_columns", missingColumns };
	if (
		EMPLOYMENT_DATE_UPLOAD_COLUMNS.some(
			(column) => columns.filter((value) => value === column).length !== 1,
		)
	)
		return { ok: false, code: "malformed_csv" };
	const rows: EmploymentDateCsvRow[] = [];
	for (const [position, record] of records.entries()) {
		if (record.every((cell) => !cell.trim())) continue;
		if (rows.length === MAX_EMPLOYMENT_DATE_UPLOAD_ROWS)
			return { ok: false, code: "too_many_rows" };
		if (record.length !== header.length) return { ok: false, code: "malformed_csv" };
		const cell = (name: (typeof EMPLOYMENT_DATE_UPLOAD_COLUMNS)[number]) =>
			(record[columns.indexOf(name)] ?? "").trim();
		const employeeNumber = cell("employee_number"),
			suppliedEmploymentStartDate = cell("employment_start_date"),
			employmentStartDate = parseOpeningBalanceDay(suppliedEmploymentStartDate),
			reason = cell("reason");
		const errors: EmploymentDateCsvError[] = [];
		if (!employeeNumber) errors.push("employee_number_required");
		if (!employmentStartDate) errors.push("invalid_date");
		if (!reason) errors.push("reason_required");
		else if (reason.length > 1000) errors.push("reason_too_long");
		rows.push({
			row: position + 2,
			employeeNumber,
			employmentStartDate,
			suppliedEmploymentStartDate,
			reason,
			errors,
		});
	}
	return rows.length ? { ok: true, rows } : { ok: false, code: "no_rows" };
}
export function employmentDateUploadTemplate(): string {
	return (
		Papa.unparse(
			{
				fields: [...EMPLOYMENT_DATE_UPLOAD_COLUMNS],
				data: [
					["1001", "2019-01-01", "Actual joining date from signed employment record"],
					["1002", "2021-02-01", "Actual joining date from signed employment record"],
				],
			},
			{ newline: "\r\n" },
		) + "\r\n"
	);
}
