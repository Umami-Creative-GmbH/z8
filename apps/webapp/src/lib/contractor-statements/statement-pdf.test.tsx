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
			"1.00 Days",
			"0.50 Days",
			"09:00–12:00",
			"No rate applies",
			"€900.00",
			"1.50 Days",
			"Some work had no agreed rate on its day.",
			"Some work still awaits approval of a change",
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
		expect(text).toContain("Zeit- und Honorarnachweis für externe Dienstleister");
		expect(text).toContain("Kein Rechnungs- oder Gutschriftsdokument");
		expect(text).toContain("900,00 €");
		expect(text).toContain("Halber Tag bis 240 Min., darüber voller Tag");
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
						awaitingApprovalLines: 0,
					}),
					{ t: catalogT("en"), locale: "en" },
				),
			),
		);
		expect(text).toContain("No completed work as External Contractor in this period.");
	});
});
