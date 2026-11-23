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
			"Awaiting approval",
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
				"",
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
				"No",
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
				"Yes",
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
				"",
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
				"No",
				"",
				"",
				"",
				"EUR",
				"",
				"",
				"300.00",
			],
			["Day", "2026-03-20", "", "", "", "", "60", "", "No rate applies", "", "", "", "", "", ""],
			[
				"Work",
				"2026-03-20",
				"2026-03-20T09:00+01:00",
				"2026-03-20T10:00+01:00",
				"",
				"",
				"60",
				"No",
				"",
				"",
				"",
				"",
				"",
				"",
				"",
			],
			["Total", "", "", "", "", "", "390", "", "", "", "", "EUR", "1.5000", "Days", "900.00"],
			["Unpriced", "", "", "", "", "", "60", "", "", "", "", "", "", "", ""],
		]);
	});

	it("is written in German for a German exporter", () => {
		const csv = contractorStatementCsv(sampleStatement(), { t: catalogT("de") });
		const table = rows(csv);
		expect(table[0]).toEqual(["Zeit- und Honorarnachweis für externe Dienstleister"]);
		expect(table[1][0]).toContain("Kein Rechnungs- oder Gutschriftsdokument");
		expect(table.find((row) => row[0] === "Zeilenart")).toContain("Betrag");
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
