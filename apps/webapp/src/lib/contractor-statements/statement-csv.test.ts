import { describe, expect, it } from "vitest";
import { contractorStatementCsv, contractorStatementFilename } from "./statement-csv";
import { catalogT, sampleStatement } from "./testing/statement.test.fixture";

/** The file's rows as cells, quotes removed (no cell of the sample holds a quote). */
function rows(csv: string): string[][] {
	return csv
		.replace(/^﻿/, "")
		.trimEnd()
		.split("\r\n")
		.map((line) =>
			[...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)]
				.filter((match) => match.index < line.length || match[0] !== "")
				.map((match) => match[2] ?? match[1]),
		);
}

describe("contractor statement CSV", () => {
	it("is labelled a verification statement and never an invoice", () => {
		const csv = contractorStatementCsv(sampleStatement(), { t: catalogT("en") });
		const [title, notice] = rows(csv);
		expect(title).toEqual(["Contractor Time & Fee Verification Statement"]);
		expect(notice[0]).toContain("Not an invoice or self-billing credit note (Gutschrift)");
		expect(csv).not.toMatch(/\binvoice number\b|\bRechnung Nr\b/i);
	});

	it("lists the period, contractor and contracting details", () => {
		const table = rows(contractorStatementCsv(sampleStatement(), { t: catalogT("en") }));
		expect(table.slice(2, 10)).toEqual([
			["Organization", "Acme GmbH"],
			["Contractor", "Jo Freelance"],
			["Contractor number", "C-7"],
			["Company", "Jo Consulting UG"],
			["VAT ID", "DE123456789"],
			// Formula-like text is neutralized for spreadsheets.
			["PO or cost-center reference", "'=PO-4711"],
			["Period", "2026-03-01", "2026-03-31"],
			["Generated (UTC)", "2026-04-01T08:00:00Z"],
		]);
	});

	it("says it lists approved work only and counts the work awaiting approval", () => {
		const table = rows(contractorStatementCsv(sampleStatement(), { t: catalogT("en") }));
		expect(table.slice(10, 12)).toEqual([
			["Only approved work is listed. Work awaiting approval is added once it is approved."],
			["Work periods awaiting approval, not included: 2"],
		]);
		const none = rows(
			contractorStatementCsv(sampleStatement({ awaitingApprovalWorkPeriods: 0 }), {
				t: catalogT("de"),
			}),
		);
		expect(none[11]).toEqual([]);
		expect(none[10][0]).toContain("Nur genehmigte Arbeitszeit");
	});

	it("itemizes days, their work by project and task, and the totals", () => {
		const table = rows(contractorStatementCsv(sampleStatement(), { t: catalogT("en") }));
		const start = table.findIndex((row) => row[0] === "Row type");
		expect(table[start]).toEqual([
			"Row type",
			"Date",
			"Start",
			"End",
			"Project",
			"Task",
			"Worked minutes",
			"Paid by",
			"Day-unit rule",
			"Rate",
			"Currency",
			"Units",
			"Unit",
			"Amount",
		]);
		expect(table.slice(start + 1)).toEqual([
			[
				"Day",
				"2026-03-02",
				"",
				"",
				"",
				"",
				"270",
				"Day rate",
				"Half day up to 240 min, full day above",
				"600.00",
				"EUR",
				"1.0000",
				"Days",
				"600.00",
			],
			[
				"Work",
				"2026-03-02",
				"2026-03-02T09:00+01:00",
				"2026-03-02T12:00+01:00",
				"Website, relaunch",
				"Design",
				"180",
				"",
				"",
				"",
				"EUR",
				"",
				"",
				"400.00",
			],
			[
				"Work",
				"2026-03-02",
				"2026-03-02T13:00+01:00",
				"2026-03-02T14:30+01:00",
				"Shop",
				"",
				"90",
				"",
				"",
				"",
				"EUR",
				"",
				"",
				"200.00",
			],
			[
				"Day",
				"2026-03-03",
				"",
				"",
				"",
				"",
				"120",
				"Day rate",
				"Half day up to 240 min, full day above",
				"600.00",
				"EUR",
				"0.5000",
				"Days",
				"300.00",
			],
			[
				"Work",
				"2026-03-03",
				"2026-03-03T09:00+01:00",
				"2026-03-03T11:00+01:00",
				"Shop",
				"",
				"120",
				"",
				"",
				"",
				"EUR",
				"",
				"",
				"300.00",
			],
			["Day", "2026-03-20", "", "", "", "", "60", "No rate applies", "", "", "", "", "", ""],
			[
				"Work",
				"2026-03-20",
				"2026-03-20T09:00+01:00",
				"2026-03-20T10:00+01:00",
				"",
				"",
				"60",
				"",
				"",
				"",
				"",
				"",
				"",
				"",
			],
			["Total", "", "", "", "", "", "390", "", "", "", "EUR", "1.5000", "Days", "900.00"],
			["Unpriced", "", "", "", "", "", "60", "", "", "", "", "", "", ""],
		]);
	});

	it("writes number-like project and task names as text, never as numbers", () => {
		const base = sampleStatement();
		const day = base.days[0];
		const csv = contractorStatementCsv(
			sampleStatement({
				days: [
					{
						...day,
						lines: [{ ...day.lines[0], projectName: "0042", taskName: "-1.50" }],
					},
				],
			}),
			{ t: catalogT("en") },
		);
		const workRow = csv.split("\r\n").find((line) => line.startsWith('"Work"'));
		expect(workRow).toContain(',"0042",');
		// A leading minus is also formula-neutralized.
		expect(workRow).toContain(`,"'-1.50",`);
		// Figures stay numbers.
		expect(workRow).toMatch(/,180,/);
		expect(workRow).toMatch(/,400\.00$/);
	});

	it("is written in German for a German exporter", () => {
		const csv = contractorStatementCsv(sampleStatement(), { t: catalogT("de") });
		const table = rows(csv);
		expect(table[0]).toEqual(["Zeit- und Honorarnachweis für Auftragnehmer"]);
		expect(table[1][0]).toContain("Keine Rechnung oder Gutschrift im Gutschriftsverfahren");
		expect(table.find((row) => row[0] === "Zeilentyp")).toContain("Betrag");
		expect(table.find((row) => row[0] === "Tag")).toContain(
			"Halber Tag bis 240 Min., darüber voller Tag",
		);
	});

	it("names the file after the contractor and period", () => {
		expect(contractorStatementFilename(sampleStatement(), "csv")).toBe(
			"contractor-statement-jo-freelance-2026-03-01-2026-03-31.csv",
		);
	});
});
