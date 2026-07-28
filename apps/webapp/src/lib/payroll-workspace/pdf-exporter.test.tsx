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
	it("sorts employee sections and same-date absence rows in audit order", () => {
		const orderingSummary: PayrollWorkspaceSummary = {
			...summary,
			employees: [
				{
					...summary.employees[0],
					id: "employee-2",
					name: "Grace Hopper",
					employeeNumber: "E-2",
				},
				summary.employees[0],
			],
			absenceDetails: [
				{
					employeeId: "employee-2",
					categoryId: "sick",
					categoryName: "Sick",
					date: "2026-06-04",
					period: "full_day",
				},
				{
					employeeId: "employee-1",
					categoryId: "vacation",
					categoryName: "Vacation",
					date: "2026-06-03",
					period: "full_day",
				},
				{
					employeeId: "employee-1",
					categoryId: "sick-b",
					categoryName: "Sick",
					date: "2026-06-03",
					period: "am",
				},
				{
					employeeId: "employee-1",
					categoryId: "sick-a",
					categoryName: "Sick",
					date: "2026-06-03",
					period: "pm",
				},
			],
		};

		expect(buildPayrollAbsenceSections(orderingSummary)).toEqual([
			{
				employeeId: "employee-1",
				employeeName: "Ada Lovelace",
				employeeNumber: "E-1",
				rows: [
					{ date: "2026-06-03", categoryName: "Sick", periodLabel: "PM" },
					{ date: "2026-06-03", categoryName: "Sick", periodLabel: "AM" },
					{
						date: "2026-06-03",
						categoryName: "Vacation",
						periodLabel: "Full day",
					},
				],
			},
			{
				employeeId: "employee-2",
				employeeName: "Grace Hopper",
				employeeNumber: "E-2",
				rows: [
					{ date: "2026-06-04", categoryName: "Sick", periodLabel: "Full day" },
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
