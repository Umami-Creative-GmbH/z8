import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";
import { avvPdfText as pdfText } from "@/lib/avv/avv-pdf.test.fixture";
import {
	buildPayrollPeriodRead,
	type PayrollPeriodSources,
} from "@/lib/payroll-period/period-read";
import type { PayrollPeriodRead } from "@/lib/payroll-period/types";
import {
	buildPayrollAbsenceSections,
	exportPayrollPeriodToPDF,
	flattenPayrollAbsenceSections,
	generatePayrollPDFFilename,
	type PayrollPdfTranslate,
} from "./pdf-exporter";
import type { PayrollWorkspaceSummary } from "./types";

function countPDFPages(pdf: Uint8Array): number {
	return (
		Buffer.from(pdf)
			.toString("latin1")
			.match(/\/Type \/Page\b/g)?.length ?? 0
	);
}

/** Tolgee's English fallback: the static default with `{name}` placeholders filled in. */
const englishT: PayrollPdfTranslate = (_key, defaultValue, params) =>
	interpolate(defaultValue, params);

function interpolate(text: string, params?: Record<string, string | number>): string {
	return text.replace(/\{(\w+)\}/g, (match, name: string) =>
		params && name in params ? String(params[name]) : match,
	);
}

const anna = {
	id: "employee-1",
	name: "Anna Berg",
	employeeNumber: "E-1",
	teamName: "Ops",
	contractType: "fixed" as const,
	timezone: "Europe/Berlin",
};
const ben = { ...anna, id: "employee-2", name: "Ben Cole", employeeNumber: "E-2" };

function work(employeeId: string, date: string, minutes: number) {
	const startAt = Temporal.Instant.from(`${date}T07:00:00Z`);
	return {
		recordId: `${employeeId}-${date}`,
		employeeId,
		startAt,
		endExclusive: startAt.add({ minutes }),
		minutes,
	};
}

function settled(employeeId: string, date: string, paidMinutes: number) {
	return {
		id: `settled-${employeeId}-${date}`,
		employeeId,
		date,
		method: "manual" as const,
		payrollExportJobId: null,
		settledAt: "2026-11-06T10:00:00.000Z",
		paid: { creditedMinutes: paidMinutes, absences: [] },
	};
}

const weekdays = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];

function periodRead(
	sources: Partial<PayrollPeriodSources> = {},
	period = { start: "2026-11-01", end: "2026-11-07", label: "Week 45" },
): PayrollPeriodRead {
	return buildPayrollPeriodRead({
		organizationId: "organization-a",
		period,
		generatedAt: DateTime.fromISO("2026-11-07T12:00:00Z"),
		generatedBy: { id: "payroll-1", name: "Payroll User" },
		sources: {
			organizationName: "Acme GmbH",
			employees: [anna, ben],
			work: [
				work(anna.id, "2026-11-02", 480),
				work(anna.id, "2026-11-03", 570),
				work(anna.id, "2026-11-04", 480),
				work(ben.id, "2026-11-02", 240),
			],
			absences: [
				{
					id: "absence-1",
					employeeId: anna.id,
					categoryId: "vacation",
					categoryName: "Vacation",
					categoryType: "vacation",
					categoryColor: null,
					startDate: "2026-11-06",
					endDate: "2026-11-06",
					startPeriod: "am",
					endPeriod: "am",
					approvalState: "approved",
				},
			],
			blockers: [],
			requirements: new Map([
				[anna.id, Object.fromEntries(weekdays.map((date) => [date, { requiredMinutes: 480 }]))],
			]),
			holidays: new Map([
				[anna.id, [{ name: "Founders Day", startDate: "2026-11-05", endDate: "2026-11-05" }]],
			]),
			settledDays: [settled(anna.id, "2026-11-03", 480), settled(anna.id, "2026-11-04", 480)],
			...sources,
		},
	});
}

/** The day sheet pages of one employee: their page header names the employee. */
function daySheetPages(text: string, employeeName: string): string[] {
	return text.split("\n").filter((page) => page.includes(`Day sheet ${employeeName}`));
}

describe("payroll PDF day sheets", () => {
	it("gives each employee in scope a day sheet with one row per local day", async () => {
		const text = await pdfText(
			await exportPayrollPeriodToPDF(periodRead(), { t: englishT, locale: "en" }),
		);

		const [annaSheet] = daySheetPages(text, "Anna Berg");
		expect(annaSheet).toBeDefined();
		expect(daySheetPages(text, "Ben Cole")).toHaveLength(1);
		for (const date of ["11/1/2026", "11/2/2026", "11/7/2026"]) {
			expect(annaSheet).toContain(date);
		}
		expect(annaSheet).toContain("Founders Day");
		expect(annaSheet).toContain("Vacation (AM)");
	});

	it("ends each sheet with a total row matching the summary totals", async () => {
		const text = await pdfText(
			await exportPayrollPeriodToPDF(periodRead(), { t: englishT, locale: "en" }),
		);

		// 480 + 570 + 480 minutes; 2,400 required on five weekdays.
		expect(daySheetPages(text, "Anna Berg")[0]).toMatch(/Total\s+25\.50 h\s+40\.00 h\s+-14\.50 h/);
		expect(daySheetPages(text, "Ben Cole")[0]).toMatch(/Total\s+4\.00 h/);
		const summaryPage = text.split("\n")[0];
		expect(summaryPage).toContain("25.50 h");
		expect(summaryPage).toContain("29.50 h");
	});

	it("marks settled and changed-since-settled days apart", async () => {
		const text = await pdfText(
			await exportPayrollPeriodToPDF(periodRead(), { t: englishT, locale: "en" }),
		);
		const sheet = daySheetPages(text, "Anna Berg")[0] ?? "";

		// 3 Nov was settled at 8 h and now has 9.5 h; 4 Nov is unchanged.
		expect(sheet).toMatch(/11\/3\/2026.*Changed since settled\s+\+1\.5 h/);
		expect(sheet).toMatch(/11\/4\/2026.*Settled/);
		expect(sheet).not.toMatch(/11\/2\/2026[^/]*Settled/);
	});

	it("uses the exporter's language and locale formatting", async () => {
		const german: Record<string, string> = {
			"payroll.pdf.daySheet.title": "Tagesblatt {name}",
			"payroll.pdf.daySheet.total": "Summe",
			"payroll.pdf.daySheet.settled": "Abgerechnet",
			"payroll.pdf.daySheet.changedSinceSettled": "Seit Abrechnung geändert",
			"payroll.pdf.summary.kicker": "Lohnabrechnungsprüfung",
			"payroll.pdf.summary.workedHours": "Gearbeitete Stunden",
		};
		const germanT: PayrollPdfTranslate = (key, defaultValue, params) =>
			interpolate(german[key] ?? defaultValue, params);

		const text = await pdfText(
			await exportPayrollPeriodToPDF(periodRead(), { t: germanT, locale: "de" }),
		);
		const sheet = text.split("\n").find((page) => page.includes("Tagesblatt Anna Berg")) ?? "";

		expect(text).toContain("Lohnabrechnungsprüfung");
		expect(text).toMatch(/Gearbeitete Stunden/i);
		expect(sheet).toContain("3.11.2026");
		expect(sheet).toMatch(/Summe\s+25,50 h/);
		expect(sheet).toMatch(/Seit Abrechnung geändert\s+\+1,5 h/);
		expect(sheet).toContain("Abgerechnet");
		expect(text).not.toContain("Day sheet");
	});

	it("repeats the page header when a long period flows across pages", async () => {
		const read = periodRead(
			{
				employees: [anna],
				work: [],
				absences: [],
				settledDays: [],
				requirements: new Map(),
				holidays: new Map(),
			},
			{ start: "2026-01-01", end: "2026-03-31", label: "Q1 2026" },
		);
		const pages = daySheetPages(
			await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" })),
			"Anna Berg",
		);

		expect(pages.length).toBeGreaterThan(1);
		for (const page of pages) {
			expect(page).toMatch(/Date\s+Worked\s+Required\s+Difference/i);
		}
	}, 15_000);
});

const summary: PayrollWorkspaceSummary = {
	organizationId: "organization-a",
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
			date: "2026-06-03",
			time: "09:00",
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
				rows: [{ date: "2026-06-04", categoryName: "Sick", periodLabel: "Full day" }],
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
			buildPayrollAbsenceSections(nameOrderingSummary).map((section) => section.employeeName),
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
			buildPayrollAbsenceSections(identicalNamesSummary).map((section) => section.employeeId),
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
					rows: [{ date: "2026-06-04", categoryName: "Vacation", periodLabel: "PM" }],
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
		expect(buildPayrollAbsenceSections({ ...summary, absenceDetails: [] })).toEqual([]);
	});

	it("generates a stable filename", () => {
		expect(generatePayrollPDFFilename(summary)).toBe("payroll-acme-gmbh-2026-06-01-2026-06-30.pdf");
	});

	it("keeps the summary page with totals and blockers", async () => {
		const read = periodRead({
			blockers: [
				{
					id: "blocker-1",
					employeeId: ben.id,
					type: "missing_clock_out",
					label: "Missing clock-out",
					date: "2026-11-02",
					time: "09:00",
				},
			],
		});
		const summaryPage =
			(await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" }))).split(
				"\n",
			)[0] ?? "";

		expect(summaryPage).toContain("Payroll export audit");
		expect(summaryPage).toContain("Acme GmbH");
		expect(summaryPage).toMatch(/Employees\s+2/i);
		expect(summaryPage).toMatch(/Ben Cole.*Missing clock-out/);
		expect(summaryPage).toMatch(/Anna Berg.*\+1\.5 h since settled/);
		expect(summaryPage).toContain("Vacation: 0.5 d");
	});

	it("exports same-source blockers of different types without duplicate keys or omission", async () => {
		const sharedId = "11111111-1111-4111-8111-111111111111";
		const blocker = {
			id: sharedId,
			employeeId: ben.id,
			type: "missing_clock_out" as const,
			label: "Missing clock-out",
			date: "2026-11-02",
			time: "09:00",
		};
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		try {
			const text = await pdfText(
				await exportPayrollPeriodToPDF(
					periodRead({ blockers: [blocker, { ...blocker, type: "pending_absence" }] }),
					{ t: englishT, locale: "en" },
				),
			);

			expect(text).toContain("Missing clock-out");
			expect(text).toContain("Pending absence");
			expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
				"Encountered two children with the same key",
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it("flows a long employee absence report across physical PDF pages", async () => {
		const read = periodRead({
			employees: [anna],
			settledDays: [],
			absences: Array.from({ length: 60 }, (_, index) => ({
				id: `absence-${index}`,
				employeeId: anna.id,
				categoryId: `category-${String(index).padStart(2, "0")}`,
				categoryName: `Approved absence category ${index + 1}`,
				categoryType: null,
				categoryColor: null,
				startDate: "2026-11-03",
				endDate: "2026-11-03",
				startPeriod: "full_day" as const,
				endPeriod: "full_day" as const,
				approvalState: "approved" as const,
			})),
		});
		const text = await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" }));
		const absencePages = text.split("\n").filter((page) => page.includes("Absence details"));

		expect(absencePages.length).toBeGreaterThan(1);
	}, 15_000);

	it("paginates a large scope into one day sheet per employee", async () => {
		const employees = Array.from({ length: 100 }, (_, index) => {
			const number = String(index + 1).padStart(3, "0");
			return {
				...anna,
				id: `employee-${number}`,
				name: `Employee ${number}`,
				employeeNumber: `E-${number}`,
			};
		});
		const read = periodRead(
			{
				employees,
				work: employees.map((employee) => work(employee.id, "2026-11-02", 480)),
				absences: [],
				settledDays: [],
				requirements: new Map(),
				holidays: new Map(),
			},
			{ start: "2026-11-02", end: "2026-11-02", label: "2 Nov 2026" },
		);

		const pdf = await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" });

		// The summary's employee table, then exactly one sheet per employee.
		expect(countPDFPages(pdf)).toBeGreaterThanOrEqual(101);
		expect(countPDFPages(pdf)).toBeLessThan(108);
	}, 30_000);
});
