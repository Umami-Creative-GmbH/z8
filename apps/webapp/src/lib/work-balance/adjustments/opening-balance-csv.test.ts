import { describe, expect, it } from "vitest";
import { openingBalanceCsvTemplate, parseOpeningBalanceCsv } from "./opening-balance-csv";

describe("parseOpeningBalanceCsv", () => {
	it("reads the template's columns, one opening balance per row", () => {
		const result = parseOpeningBalanceCsv(
			[
				"employee_number,day,balance,reason",
				"0042,2025-12-31,12:30,Carried over from the old system",
				"E-7,2025-12-31,-8:05,Hours owed",
			].join("\n"),
		);

		expect(result).toEqual({
			ok: true,
			rows: [
				{
					row: 2,
					employeeNumber: "0042",
					day: "2025-12-31",
					minutes: 750,
					reason: "Carried over from the old system",
					errors: [],
				},
				{
					row: 3,
					employeeNumber: "E-7",
					day: "2025-12-31",
					minutes: -485,
					reason: "Hours owed",
					errors: [],
				},
			],
		});
	});

	it("reads a German spreadsheet export: BOM, semicolons, DD.MM.YYYY, quoted reasons", () => {
		const result = parseOpeningBalanceCsv(
			"﻿Employee Number;Day;Balance;Reason;Notes\r\n" +
				'7;31.12.2025;-0:30;"Übertrag; alt\r\nzweite Zeile";ignored\r\n' +
				";;;\r\n" +
				'8;1.2.2026;+3:00:00;"Sagt ""ok""";\r\n',
		);

		expect(result).toEqual({
			ok: true,
			rows: [
				expect.objectContaining({
					row: 2,
					employeeNumber: "7",
					day: "2025-12-31",
					minutes: -30,
					reason: "Übertrag; alt\r\nzweite Zeile",
					errors: [],
				}),
				// The blank row 3 is skipped but still counted.
				expect.objectContaining({
					row: 4,
					employeeNumber: "8",
					day: "2026-02-01",
					minutes: 180,
					reason: 'Sagt "ok"',
					errors: [],
				}),
			],
		});
	});

	it("honours an Excel sep= line", () => {
		const result = parseOpeningBalanceCsv(
			"sep=,\nemployee_number,day,balance,reason\n1,2025-01-01,1:00,a;b\n",
		);
		expect(result).toMatchObject({ ok: true, rows: [{ row: 2, reason: "a;b", errors: [] }] });
	});

	it("reports what is wrong with each row's own cells", () => {
		const result = parseOpeningBalanceCsv(
			[
				"employee_number,day,balance,reason",
				",2025-02-30,12:60,",
				"5,31/12/2025,12.5,ok",
				`6,2025-12-31,-0:00,${"x".repeat(1001)}`,
				"7,2025-12-31,8,  ",
			].join("\n"),
		);

		expect(result.ok && result.rows.map(({ row, minutes, errors }) => ({ row, minutes, errors })))
			.toEqual([
				{
					row: 2,
					minutes: null,
					errors: ["employee_number_required", "invalid_day", "invalid_amount", "reason_required"],
				},
				{ row: 3, minutes: null, errors: ["invalid_day", "invalid_amount"] },
				{ row: 4, minutes: 0, errors: ["reason_too_long"] },
				{ row: 5, minutes: null, errors: ["invalid_amount", "reason_required"] },
			]);
	});

	it("refuses a file without the required columns, without rows, or too large", () => {
		expect(parseOpeningBalanceCsv("employee_number;balance\n1;1:00\n")).toEqual({
			ok: false,
			code: "missing_columns",
			missingColumns: ["day", "reason"],
		});
		expect(parseOpeningBalanceCsv("employee_number,day,balance,reason\n\n")).toEqual({
			ok: false,
			code: "no_rows",
		});
		expect(parseOpeningBalanceCsv("")).toEqual({ ok: false, code: "no_rows" });
		const header = "employee_number,day,balance,reason\n";
		expect(parseOpeningBalanceCsv(header + "1,2025-01-01,1:00,r\n".repeat(2001))).toEqual({
			ok: false,
			code: "too_many_rows",
		});
		expect(parseOpeningBalanceCsv(header + "x".repeat(500_001))).toEqual({
			ok: false,
			code: "file_too_large",
		});
	});

	it("parses its own template", () => {
		const template = openingBalanceCsvTemplate();
		expect(template.startsWith("employee_number,day,balance,reason\r\n")).toBe(true);
		expect(parseOpeningBalanceCsv(template)).toMatchObject({
			ok: true,
			rows: [
				{ row: 2, day: "2025-12-31", minutes: 750, errors: [] },
				{ row: 3, day: "2025-12-31", minutes: -255, errors: [] },
			],
		});
	});
});
