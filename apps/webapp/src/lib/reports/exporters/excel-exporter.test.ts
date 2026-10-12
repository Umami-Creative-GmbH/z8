import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportData } from "../types";
import { exportToExcel, generateExcelFilename } from "./excel-exporter";

const reportData: ReportData = {
	employee: {
		id: "fictional-employee",
		name: "Fixture User",
		employeeNumber: "F-001",
		position: "Fixture Engineer",
		email: "fixture@example.invalid",
		customFields: [],
	},
	period: {
		startDate: "2026-08-01",
		endDate: "2026-09-30",
		label: "August–September 2026",
	},
	workHours: {
		totalHours: 40,
		totalMinutes: 2400,
		workDays: 5,
		averagePerDay: 8,
		byMonth: new Map([
			["2026-08", { hours: 16, days: 2 }],
			["2026-09", { hours: 24, days: 3 }],
		]),
	},
	absences: {
		totalDays: 4,
		byCategory: new Map([
			["Vacation", { days: 2 }],
			["Sick", { days: 1 }],
			["Training", { days: 1 }],
		]),
		vacation: { approved: 2, pending: 1 },
		sick: { approved: 1, pending: 0 },
		homeOffice: {
			days: 2,
			hoursWorked: 14.5,
			dateDetails: [
				{ date: "2026-08-18", hours: 6.5 },
				{ date: "2026-09-15", hours: 8 },
			],
		},
		other: { approved: 1, pending: 0 },
	},
	complianceMetrics: {
		attendancePercentage: 92.5,
		overtimeMinutes: 90,
		underTimeMinutes: 30,
	},
};

describe("Excel report characterization", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
	});
	afterEach(() => vi.useRealTimers());

	it("retains the filename and all fictional report worksheet cells", async () => {
		expect(generateExcelFilename(reportData)).toBe(
			"report-fixture-user-1790942400000.xlsx",
		);
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.load(await exportToExcel(reportData));
		expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
			"Summary",
			"Work Hours",
			"Absences",
			"Home Office (Tax)",
		]);
		expect(workbook.creator).toBe("Z8 Time Tracking");
		expect(workbook.created.toISOString()).toBe("2026-10-02T12:00:00.000Z");
		expect(workbook.modified.toISOString()).toBe("2026-10-02T12:00:00.000Z");
		const rows = (name: string) => {
			const sheet = workbook.getWorksheet(name);
			if (!sheet) throw new Error(`Missing worksheet ${name}`);
			const values: Array<[ExcelJS.CellValue, ExcelJS.CellValue]> = [];
			sheet.eachRow((row) =>
				values.push([row.getCell(1).value, row.getCell(2).value]),
			);
			return values;
		};
		expect(rows("Summary")).toEqual(
			expect.arrayContaining([
				["Name", "Fixture User"],
				["Employee Number", "F-001"],
				["Position", "Fixture Engineer"],
				["Email", "fixture@example.invalid"],
				["Report Period", "August–September 2026"],
				["Generated On", "2026-10-02 12:00:00"],
				["Total Hours", 40],
				["Work Days", 5],
				["Average Hours per Day", 8],
				["Total Absence Days", 4],
				["Vacation Days (Approved)", 2],
				["Sick Days (Approved)", 1],
				["Home Office Days", 2],
				["Home Office Hours Worked", 14.5],
				["Attendance Percentage", "92.5%"],
				["Overtime Hours", 1.5],
				["Undertime Hours", 0.5],
			]),
		);
		const work = workbook.getWorksheet("Work Hours");
		expect(
			[2, 3, 5].map((index) => [
				work?.getCell(`A${index}`).value,
				work?.getCell(`B${index}`).value,
				work?.getCell(`C${index}`).value,
			]),
		).toEqual([
			["2026-08", 16, 2],
			["2026-09", 24, 3],
			["TOTAL", 40, 5],
		]);
		expect(rows("Absences")).toEqual([
			["Category", "Days"],
			["Vacation", 2],
			["Sick", 1],
			["Training", 1],
			["TOTAL", 4],
		]);
		expect(rows("Home Office (Tax)")).toEqual(
			expect.arrayContaining([
				["Total Home Office Days", 2],
				["Total Hours Worked from Home", 14.5],
				["Date", "Hours Worked"],
				["2026-08-18", 6.5],
				["2026-09-15", 8],
				["TOTAL", 14.5],
			]),
		);
	});
});
