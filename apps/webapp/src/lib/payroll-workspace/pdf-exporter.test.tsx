import { describe, expect, it } from "vitest";
import {
	buildPayrollAbsenceSections,
	exportPayrollSummaryToPDF,
	generatePayrollPDFFilename,
} from "./pdf-exporter";
import type { PayrollWorkspaceSummary } from "./types";

const summary: PayrollWorkspaceSummary = {
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: "2026-06-30T12:00:00.000Z",
	generatedBy: { id: "payroll-1", name: "Payroll User" },
	totals: { employeeCount: 1, totalWorkedHours: 12.5, blockerCount: 1 },
	employees: [
		{
			id: "employee-1",
			name: "Ada Lovelace",
			employeeNumber: "E-1",
			teamName: "Ops",
			contractType: "hourly",
			workedHours: 12.5,
			absenceDaysByCategory: [
				{ categoryId: "sick", categoryName: "Sick", days: 1 },
				{ categoryId: "vacation", categoryName: "Vacation", days: 0.5 },
			],
			hasBlockers: true,
		},
	],
	absenceDetails: [
		{
			employeeId: "employee-1",
			categoryId: "vacation",
			categoryName: "Vacation",
			date: "2026-06-08",
			period: "am",
		},
		{
			employeeId: "employee-1",
			categoryId: "sick",
			categoryName: "Sick",
			date: "2026-06-03",
			period: "full_day",
		},
	],
	blockers: [
		{
			id: "blocker-1",
			employeeId: "employee-1",
			type: "missing_clock_out",
			label: "Missing clock-out",
		},
	],
};

describe("payroll PDF exporter", () => {
	it("groups approved absence details by employee in audit order", () => {
		expect(buildPayrollAbsenceSections(summary)).toEqual([
			{
				employeeId: "employee-1",
				employeeName: "Ada Lovelace",
				employeeNumber: "E-1",
				rows: [
					{ date: "2026-06-03", categoryName: "Sick", periodLabel: "Full day" },
					{ date: "2026-06-08", categoryName: "Vacation", periodLabel: "AM" },
				],
			},
		]);
	});

	it("omits absence sections when there are no approved details", () => {
		expect(
			buildPayrollAbsenceSections({ ...summary, absenceDetails: [] }),
		).toEqual([]);
	});

	it("generates a stable filename", () => {
		expect(generatePayrollPDFFilename(summary)).toBe(
			"payroll-acme-gmbh-2026-06-01-2026-06-30.pdf",
		);
	});

	it("generates a PDF byte array", async () => {
		const pdf = await exportPayrollSummaryToPDF(summary);
		expect(pdf.byteLength).toBeGreaterThan(1000);
	});
});
