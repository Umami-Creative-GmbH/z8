import { describe, expect, it } from "vitest";
import { avvPdfText as pdfText } from "@/lib/avv/avv-pdf.test.fixture";
import { renderContractorStatementPdf } from "./statement-pdf";
import { catalogT, sampleStatement } from "./testing/statement.test.fixture";

/** pdf.js splits runs of text; compare with single spaces. */
const squash = (text: string) => text.replace(/\s+/g, " ");

describe("contractor statement PDF", () => {
	it("is labelled a verification statement on every page and never an invoice", async () => {
		const text = squash(
			await pdfText(
				await renderContractorStatementPdf(sampleStatement(), { t: catalogT("en"), locale: "en" }),
			),
		);
		expect(text).toContain("Contractor Time & Fee Verification Statement");
		expect(text).toContain("Not an invoice or self-billing credit note (Gutschrift)");
		expect(text).not.toMatch(/invoice number|invoice date|amount due/i);
	});

	it("shows the period, contractor details, itemized days and the total", async () => {
		const text = squash(
			await pdfText(
				await renderContractorStatementPdf(sampleStatement(), { t: catalogT("en"), locale: "en" }),
			),
		);
		for (const expected of [
			"Acme GmbH",
			"Jo Freelance",
			"Jo Consulting UG",
			"DE123456789",
			"=PO-4711",
			"Mar 1, 2026",
			"Mar 31, 2026",
			"Website, relaunch",
			"Design",
			"Half day up to 240 min, full day above",
			"€600.00",
			"1.0000 Days",
			"0.5000 Days",
			"09:00–12:00 UTC+01:00",
			"No rate applies",
			"€900.00",
			"1.5000 Days",
			"Some work had no agreed rate on its day.",
			"Only approved work is listed.",
			"Work periods awaiting approval, not included: 2",
		]) {
			expect(text).toContain(expected);
		}
	});

	it("is written in German for a German exporter", async () => {
		const text = squash(
			await pdfText(
				await renderContractorStatementPdf(sampleStatement(), { t: catalogT("de"), locale: "de" }),
			),
		);
		expect(text).toContain("Zeit- und Honorarnachweis für Auftragnehmer");
		expect(text).toContain("Keine Rechnung oder Gutschrift im Gutschriftsverfahren");
		expect(text).toContain("900,00 €");
		expect(text).toContain("Halber Tag bis 240 Min., darüber voller Tag");
	});

	it("shows units with the same four decimals as the CSV, so a prorated day adds up", async () => {
		const prorated = (date: string, units: string, amount: string) => ({
			date,
			workedMinutes: 420,
			pricing: {
				basis: "daily" as const,
				dayUnitRule: {
					kind: "prorated_by_standard_day" as const,
					standardDayMinutes: 480,
					capAtOneDay: true,
				},
				currency: "EUR",
				rate: "800.00",
				unit: "day" as const,
				units,
				amount,
			},
			lines: [],
		});
		const text = squash(
			await pdfText(
				await renderContractorStatementPdf(
					sampleStatement({
						days: [
							prorated("2026-03-02", "0.8750", "700.00"),
							prorated("2026-03-03", "0.1250", "100.00"),
						],
						totals: [
							{
								currency: "EUR",
								amount: "800.00",
								hours: "0.0000",
								days: "1.0000",
								workedMinutes: 480,
							},
						],
					}),
					{ t: catalogT("en"), locale: "en" },
				),
			),
		);
		expect(text).toContain("0.8750 Days");
		expect(text).toContain("0.1250 Days");
		expect(text).toContain("1.0000 Days");
		expect(text).not.toContain("0.88 Days");
	});

	it("names the time column for a range at the recorded offset, in German too", async () => {
		const en = squash(
			await pdfText(
				await renderContractorStatementPdf(sampleStatement(), { t: catalogT("en"), locale: "en" }),
			),
		);
		expect(en).toContain("Time (local)");
		const de = squash(
			await pdfText(
				await renderContractorStatementPdf(sampleStatement(), { t: catalogT("de"), locale: "de" }),
			),
		);
		expect(de).toContain("Uhrzeit (lokal)");
		expect(de).toContain("09:00–12:00 UTC+01:00");
	});

	it("flows a long statement across pages instead of clipping it", async () => {
		const names = Array.from(
			{ length: 140 },
			(_, index) => `Project ${String(index + 1).padStart(3, "0")}`,
		);
		const base = sampleStatement();
		const day = base.days[0];
		const longDay = {
			...day,
			lines: names.map((projectName, index) => ({
				...day.lines[0],
				workId: `w-${index}`,
				projectName,
				taskName: null,
			})),
		};
		const pdf = await renderContractorStatementPdf(
			sampleStatement({
				days: [longDay],
				projects: names.map((projectName) => ({
					projectName,
					currency: "EUR",
					workedMinutes: 60,
					amount: "10.00",
				})),
			}),
			{ t: catalogT("en"), locale: "en" },
		);
		const pages = (await pdfText(pdf)).split("\n").map(squash);
		// Every line of the day and every project row lands on a page, below its footer count.
		const lastPage = pages.length;
		expect(lastPage).toBeGreaterThanOrEqual(4);
		for (const [index, page] of pages.entries()) {
			expect(page).toContain(`Page ${index + 1} / ${lastPage}`);
		}
		const all = pages.join(" ");
		for (const name of names) {
			expect(all.split(name).length - 1).toBe(2);
		}
		// The table header repeats on the pages the day continues on.
		expect(pages[1]).toContain("Time (local)");
	});

	it("says so when there is no work", async () => {
		const text = squash(
			await pdfText(
				await renderContractorStatementPdf(
					sampleStatement({
						days: [],
						totals: [],
						projects: [],
						unpriced: { workedMinutes: 0, days: 0 },
						awaitingApprovalWorkPeriods: 0,
					}),
					{ t: catalogT("en"), locale: "en" },
				),
			),
		);
		expect(text).toContain("No completed work as External Contractor in this period.");
		expect(text).not.toContain("awaiting approval, not included");
	});
});
