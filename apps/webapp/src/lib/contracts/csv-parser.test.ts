import { describe, expect, it } from "vitest";
import {
	detectCsvDelimiter,
	normalizeCsvHeader,
	parseCsvBoolean,
	parseCsvCustomDays,
	parseCsvNumber,
	parseCsvText,
} from "./csv-parser";

describe("csv-parser (#1928)", () => {
	it("strips UTF-8 BOM, normalizes header aliases, and parses CRLF/LF quoted fields", () => {
		const csv =
			'\uFEFF"Employee Number",Email,"Effective From",Weekly Hours,Change Reason\r\n' +
			'EMP-001,alice@example.com,2026-07-01,38.5,"Promoted, ""senior"" band"\r\n' +
			'EMP-002,bob@example.com,2026-07-01,40,"Line 1\nLine 2"\r\n\r\n';

		const parsed = parseCsvText(csv);
		expect(parsed.delimiter).toBe(",");
		expect(parsed.headers).toEqual([
			"employee_number",
			"email",
			"effective_from_date",
			"weekly_hours",
			"change_reason",
		]);
		expect(parsed.rows).toEqual([
			{
				rowNumber: 2,
				values: {
					employee_number: "EMP-001",
					email: "alice@example.com",
					effective_from_date: "2026-07-01",
					weekly_hours: "38.5",
					change_reason: 'Promoted, "senior" band',
				},
			},
			{
				rowNumber: 3,
				values: {
					employee_number: "EMP-002",
					email: "bob@example.com",
					effective_from_date: "2026-07-01",
					weekly_hours: "40",
					change_reason: "Line 1\nLine 2",
				},
			},
		]);
	});

	it("auto-detects semicolon-delimited German/Excel CSV files", () => {
		const csv = "Personalnummer;Austrittsdatum;Reason\nPN-100;2026-06-30;Mutual agreement";
		expect(detectCsvDelimiter(csv)).toBe(";");
		const parsed = parseCsvText(csv);
		expect(parsed.delimiter).toBe(";");
		expect(parsed.headers).toEqual(["employee_number", "last_working_day", "reason"]);
		expect(parsed.rows[0]?.values).toEqual({
			employee_number: "PN-100",
			last_working_day: "2026-06-30",
			reason: "Mutual agreement",
		});
	});

	it("throws on unterminated quoted fields", () => {
		expect(() => parseCsvText('email,reason\nalice@example.com,"unterminated')).toThrow(
			/Unterminated quoted field/,
		);
	});

	it("parses booleans, numbers, headers, and custom_days shorthand or JSON", () => {
		expect(normalizeCsvHeader("  Hourly Wage ")).toBe("hourly_rate");
		expect(parseCsvBoolean("yes")).toBe(true);
		expect(parseCsvBoolean("nein")).toBe(false);
		expect(parseCsvBoolean("")).toBeNull();
		expect(() => parseCsvBoolean("maybe")).toThrow(/Invalid boolean/);

		expect(parseCsvNumber("24,50")).toBe(24.5);
		expect(parseCsvNumber("40")).toBe(40);
		expect(parseCsvNumber("")).toBeNull();
		expect(() => parseCsvNumber("abc")).toThrow(/Invalid numeric/);

		expect(parseCsvCustomDays("mon:8h@09:00|tue:480|fri:0")).toEqual([
			{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: true, latestClockIn: "09:00" },
			{ dayOfWeek: "tuesday", minutesPerDay: 480, isWorkDay: true, latestClockIn: null },
			{ dayOfWeek: "friday", minutesPerDay: 0, isWorkDay: false, latestClockIn: null },
		]);

		// P3-3: German decimal commas inside pipe- or comma-separated custom_days entries
		expect(parseCsvCustomDays("mon:7,5h|fri:4h")).toEqual([
			{ dayOfWeek: "monday", minutesPerDay: 450, isWorkDay: true, latestClockIn: null },
			{ dayOfWeek: "friday", minutesPerDay: 240, isWorkDay: true, latestClockIn: null },
		]);
		expect(parseCsvCustomDays("mon:7,5h,tue:6,25h@08:30")).toEqual([
			{ dayOfWeek: "monday", minutesPerDay: 450, isWorkDay: true, latestClockIn: null },
			{ dayOfWeek: "tuesday", minutesPerDay: 375, isWorkDay: true, latestClockIn: "08:30" },
		]);

		expect(
			parseCsvCustomDays('[{"dayOfWeek":"monday","minutesPerDay":360,"isWorkDay":true}]'),
		).toEqual([{ dayOfWeek: "monday", minutesPerDay: 360, isWorkDay: true, latestClockIn: null }]);
	});
});
