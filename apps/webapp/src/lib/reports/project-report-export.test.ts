import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { BillableFigures } from "@/lib/billable-time/report-figures";
import { exportReportDocumentToCSV } from "./exporters/report-document-csv";
import { exportReportDocumentToExcel } from "./exporters/report-document-excel";
import { exportReportDocumentToPDF } from "./exporters/report-document-pdf";
import {
	buildCustomerReportDocument,
	buildProjectReportDocument,
	DEFAULT_PROJECT_REPORT_EXPORT_LABELS,
} from "./project-report-export";
import type { CustomerBillableReport, ProjectDetailedReport } from "./project-types";

const context = { labels: DEFAULT_PROJECT_REPORT_EXPORT_LABELS, generatedAt: "2026-05-02 10:00" };

const fullFigures: BillableFigures = {
	access: "full",
	currency: "EUR",
	billableMinutes: 420,
	billableHours: 7,
	nonBillableMinutes: 60,
	nonBillableHours: 1,
	unpricedWorkCount: 0,
	unpricedHours: 0,
	pendingReviewCount: 2,
	revenue: "740.00",
	cost: "350.00",
	margin: "390.00",
	marginPercent: "52.7",
	costUnknownWorkCount: 0,
};

const revenueFigures: BillableFigures = {
	access: "revenue",
	currency: "EUR",
	billableMinutes: 420,
	billableHours: 7,
	nonBillableMinutes: 60,
	nonBillableHours: 1,
	unpricedWorkCount: 0,
	unpricedHours: 0,
	pendingReviewCount: 2,
	revenue: "740.00",
};

function projectReport(billable: BillableFigures | undefined): ProjectDetailedReport {
	return {
		project: {
			id: "p1",
			name: "Website",
			description: null,
			status: "active",
			color: null,
			budgetHours: null,
			deadline: null,
			customer: { id: "c1", name: "Acme" },
		},
		period: {
			startDate: "2026-03-01T00:00:00.000Z",
			endDate: "2026-04-30T00:00:00.000Z",
			label: "",
		},
		summary: {
			totalHours: 8,
			totalMinutes: 480,
			budgetHours: null,
			percentBudgetUsed: null,
			remainingBudgetHours: null,
			uniqueEmployees: 1,
			workPeriodCount: 4,
			averageHoursPerDay: 0.13,
			...(billable ? { billable } : {}),
		},
		timeSeries: [{ date: "2026-03-01", hours: 1, cumulativeHours: 1 }],
		teamBreakdown: [],
		employeeBreakdown: [
			{
				employeeId: "e1",
				employeeName: "Robin, Worker",
				totalHours: 8,
				totalMinutes: 480,
				workPeriodCount: 4,
				percentOfTotal: 100,
				...(billable ? { billable } : {}),
			},
		],
		...(billable
			? { billableTime: { currency: "EUR", ratesResolvedAt: "2026-05-02T08:00:00Z" } }
			: {}),
	};
}

describe("project report export", () => {
	it("exports a project manager's report without any cost or margin column", () => {
		const csv = exportReportDocumentToCSV(
			buildProjectReportDocument(projectReport(revenueFigures), context),
		);

		expect(csv).toContain("Revenue (EUR)");
		expect(csv).toContain("740.00");
		expect(csv).not.toMatch(/cost|margin/i);
	});

	it("exports cost and margin for owners, and an unknown cost as such", () => {
		const unknown: BillableFigures = { ...fullFigures, cost: null, margin: null, marginPercent: null };
		const document = buildProjectReportDocument(projectReport(unknown), context);
		const csv = exportReportDocumentToCSV(document);

		expect(csv).toContain("Cost (EUR)");
		expect(csv).toContain("Margin (EUR)");
		expect(csv).toContain("Cost unknown");
		expect(csv).not.toContain("100.0");
		// A comma in a name is quoted.
		expect(csv).toContain('"Robin, Worker"');
	});

	it("exports hours only when the report has no Billable Time figures", () => {
		const csv = exportReportDocumentToCSV(buildProjectReportDocument(projectReport(undefined), context));

		expect(csv).toContain("Hours");
		expect(csv).not.toMatch(/revenue|billable/i);
	});

	it("writes money as two-decimal numbers in Excel", async () => {
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.load(
			await exportReportDocumentToExcel(buildProjectReportDocument(projectReport(fullFigures), context)),
		);
		const employees = workbook.getWorksheet("Employees");
		const header = (employees?.getRow(1).values as ExcelJS.CellValue[]).slice(1);
		const row = (employees?.getRow(2).values as ExcelJS.CellValue[]).slice(1);
		const revenue = header.indexOf("Revenue (EUR)");

		expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
			"Project report – Website",
			"Summary",
			"Employees",
			"Hours per day",
		]);
		expect(row[0]).toBe("Robin, Worker");
		expect(row[revenue]).toBe(740);
		expect(employees?.getRow(2).getCell(revenue + 1).numFmt).toBe("#,##0.00");
	});

	it("renders the same document as a PDF", async () => {
		const bytes = await exportReportDocumentToPDF(
			buildProjectReportDocument(projectReport(fullFigures), context),
		);

		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
	}, 30_000);

	it("exports the customer view with its totals row", () => {
		const view: CustomerBillableReport = {
			period: { startDate: "2026-03-01T00:00:00.000Z", endDate: "2026-04-30T00:00:00.000Z" },
			access: "revenue",
			billableTime: { currency: "EUR", ratesResolvedAt: "2026-05-02T08:00:00Z" },
			customers: [
				{
					customer: { id: "c1", name: "Acme" },
					totalHours: 8,
					totalMinutes: 480,
					workPeriodCount: 4,
					billable: revenueFigures,
					projects: [
						{
							project: projectReport(undefined).project,
							totalHours: 8,
							totalMinutes: 480,
							workPeriodCount: 4,
							billable: revenueFigures,
						},
					],
				},
			],
			totals: { totalHours: 8, totalMinutes: 480, workPeriodCount: 4, billable: revenueFigures },
		};
		const document = buildCustomerReportDocument(view, context);

		expect(document.tables.map((table) => table.title)).toEqual(["Customers", "Projects"]);
		expect(document.tables[0]?.totals?.[0]).toBe("Total");
		expect(document.tables[1]?.rows[0]?.slice(0, 2)).toEqual(["Acme", "Website"]);
		expect(exportReportDocumentToCSV(document)).not.toMatch(/cost|margin/i);
	});
});
