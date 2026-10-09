import { describe, expect, it } from "vitest";
import { exportReportDocumentToCSV } from "@/lib/reports/exporters/report-document-csv";
import { exportReportDocumentToPDF } from "@/lib/reports/exporters/report-document-pdf";
import { buildTimesheetDocument, DEFAULT_TIMESHEET_LABELS } from "./timesheet-document";

const draft = {
	customerName: "Acme GmbH",
	period: { from: "2026-09-01", to: "2026-09-30" },
	timesheet: [
		{
			day: "2026-09-02",
			employeeName: "Berg, Anna",
			projectName: "Website",
			start: "08:00",
			end: "09:30",
			hours: "1.50",
		},
		{
			day: "2026-09-03",
			employeeName: "Ben Ott",
			projectName: "App",
			start: "08:00",
			end: "09:01",
			hours: "1.02",
		},
	],
};

describe("timesheet document", () => {
	it("lists every handed-off work period with its day, people, times and hours, and totals the hours", () => {
		const document = buildTimesheetDocument(draft, {
			labels: DEFAULT_TIMESHEET_LABELS,
			generatedAt: "2026-10-01 10:00",
		});
		const csv = exportReportDocumentToCSV(document);

		expect(csv).toContain("Date,Employee,Project,Start,End,Hours");
		expect(csv).toContain('2026-09-02,"Berg, Anna",Website,08:00,09:30,1.50');
		expect(csv).toContain("2026-09-03,Ben Ott,App,08:00,09:01,1.02");
		expect(csv).toMatch(/Total,,,,,2\.52/);
		expect(csv).toContain("Acme GmbH");
		expect(document.fileStem).toBe("timesheet-Acme GmbH-2026-09-01-2026-09-30");
	});

	it("renders as a PDF", async () => {
		const pdf = await exportReportDocumentToPDF(
			buildTimesheetDocument(draft, { labels: DEFAULT_TIMESHEET_LABELS, generatedAt: "now" }),
		);
		expect(pdf.byteLength).toBeGreaterThan(500);
	});
});
