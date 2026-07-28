import { describe, expect, it } from "vitest";
import {
	buildPayrollAbsenceSections,
	exportPayrollSummaryToPDF,
	flattenPayrollAbsenceSections,
	generatePayrollPDFFilename,
} from "./pdf-exporter";
import type { PayrollWorkspaceSummary } from "./types";

function countPDFPages(pdf: Uint8Array): number {
	return (
		Buffer.from(pdf)
			.toString("latin1")
			.match(/\/Type \/Page\b/g)?.length ?? 0
	);
}

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
					{ date: "2026-06-03", categoryName: "Sick", periodLabel: "AM" },
					{ date: "2026-06-03", categoryName: "Sick", periodLabel: "PM" },
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

	it("uses the visible period before category id as an absence row sort key", () => {
		const sameCategorySummary: PayrollWorkspaceSummary = {
			...summary,
			absenceDetails: [
				{
					employeeId: "employee-1",
					categoryId: "sick",
					categoryName: "Sick",
					date: "2026-06-03",
					period: "pm",
				},
				{
					employeeId: "employee-1",
					categoryId: "sick",
					categoryName: "Sick",
					date: "2026-06-03",
					period: "am",
				},
			],
		};

		expect(buildPayrollAbsenceSections(sameCategorySummary)[0]?.rows).toEqual([
			{ date: "2026-06-03", categoryName: "Sick", periodLabel: "AM" },
			{ date: "2026-06-03", categoryName: "Sick", periodLabel: "PM" },
		]);
	});

	it("formats crossing timed intervals and sorts by the visible period before category id", () => {
		const sameCategorySummary: PayrollWorkspaceSummary = {
			...summary,
			absenceDetails: [
				{
					employeeId: "employee-1",
					categoryId: "sick-a",
					categoryName: "Sick",
					date: "2026-06-03",
					period: "partial_day",
				},
				{
					employeeId: "employee-1",
					categoryId: "sick-z",
					categoryName: "Sick",
					date: "2026-06-03",
					period: "am",
				},
			],
		};

		expect(buildPayrollAbsenceSections(sameCategorySummary)[0]?.rows).toEqual([
			{ date: "2026-06-03", categoryName: "Sick", periodLabel: "AM" },
			{
				date: "2026-06-03",
				categoryName: "Sick",
				periodLabel: "Partial day",
			},
		]);
	});

	it("uses payroll summary name sorting semantics for employee sections", () => {
		const nameOrderingSummary: PayrollWorkspaceSummary = {
			...summary,
			employees: [
				{
					...summary.employees[0],
					id: "employee-2",
					name: "Zoe",
				},
				{
					...summary.employees[0],
					name: "ada",
				},
			],
			absenceDetails: [
				{ ...summary.absenceDetails[0], employeeId: "employee-2" },
				{ ...summary.absenceDetails[0], employeeId: "employee-1" },
			],
		};

		expect(
			buildPayrollAbsenceSections(nameOrderingSummary).map(
				(section) => section.employeeName,
			),
		).toEqual(["ada", "Zoe"]);
	});

	it("sorts employees with identical names by id", () => {
		const identicalNamesSummary: PayrollWorkspaceSummary = {
			...summary,
			employees: [
				{
					...summary.employees[0],
					id: "employee-2",
					name: "Alex Smith",
				},
				{
					...summary.employees[0],
					name: "Alex Smith",
				},
			],
			absenceDetails: [
				{ ...summary.absenceDetails[0], employeeId: "employee-2" },
				{ ...summary.absenceDetails[0], employeeId: "employee-1" },
			],
		};

		expect(
			buildPayrollAbsenceSections(identicalNamesSummary).map(
				(section) => section.employeeId,
			),
		).toEqual(["employee-1", "employee-2"]);
	});

	it("preserves duplicate absence details", () => {
		const duplicateDetail = summary.absenceDetails[0];
		const duplicateSummary: PayrollWorkspaceSummary = {
			...summary,
			absenceDetails: [duplicateDetail, duplicateDetail],
		};

		expect(buildPayrollAbsenceSections(duplicateSummary)[0]?.rows).toEqual([
			{ date: "2026-06-08", categoryName: "Vacation", periodLabel: "AM" },
			{ date: "2026-06-08", categoryName: "Vacation", periodLabel: "AM" },
		]);
	});

	it("flattens grouped rows without losing employee context or duplicates", () => {
		expect(
			flattenPayrollAbsenceSections([
				{
					employeeId: "employee-1",
					employeeName: "Ada Lovelace",
					employeeNumber: "E-1",
					rows: [
						{ date: "2026-06-03", categoryName: "Sick", periodLabel: "AM" },
						{ date: "2026-06-03", categoryName: "Sick", periodLabel: "AM" },
					],
				},
				{
					employeeId: "employee-2",
					employeeName: "Grace Hopper",
					employeeNumber: null,
					rows: [
						{ date: "2026-06-04", categoryName: "Vacation", periodLabel: "PM" },
					],
				},
			]),
		).toEqual([
			{
				employeeName: "Ada Lovelace",
				employeeNumber: "E-1",
				date: "2026-06-03",
				categoryName: "Sick",
				periodLabel: "AM",
			},
			{
				employeeName: "Ada Lovelace",
				employeeNumber: "E-1",
				date: "2026-06-03",
				categoryName: "Sick",
				periodLabel: "AM",
			},
			{
				employeeName: "Grace Hopper",
				employeeNumber: "No employee no.",
				date: "2026-06-04",
				categoryName: "Vacation",
				periodLabel: "PM",
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

	it("generates a PDF byte array without absence details", async () => {
		const pdf = await exportPayrollSummaryToPDF({
			...summary,
			absenceDetails: [],
		});
		expect(pdf.byteLength).toBeGreaterThan(1000);
	});

	it("flows a long employee absence report across physical PDF pages", async () => {
		const pdf = await exportPayrollSummaryToPDF({
			...summary,
			absenceDetails: Array.from({ length: 60 }, (_, index) => ({
				employeeId: "employee-1",
				categoryId: `category-${String(index).padStart(2, "0")}`,
				categoryName: `Approved absence category ${index + 1}`,
				date: "2026-06-03",
				period: "full_day" as const,
			})),
		});
		const pageCount = countPDFPages(pdf);

		expect(pageCount).toBeGreaterThan(2);
	});

	it("keeps one-row employee absence reports compact", async () => {
		const employees = Array.from({ length: 100 }, (_, index) => {
			const employeeNumber = String(index + 1).padStart(3, "0");
			return {
				...summary.employees[0],
				id: `employee-${employeeNumber}`,
				name: `Employee ${employeeNumber}`,
				employeeNumber: `E-${employeeNumber}`,
			};
		});
		const pdf = await exportPayrollSummaryToPDF({
			...summary,
			totals: { ...summary.totals, employeeCount: employees.length },
			employees,
			absenceDetails: employees.map((employee) => ({
				employeeId: employee.id,
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-03",
				period: "full_day" as const,
			})),
			blockers: [],
		});

		const pageCount = countPDFPages(pdf);

		expect(pageCount).toBeLessThan(20);
	}, 15_000);
});
