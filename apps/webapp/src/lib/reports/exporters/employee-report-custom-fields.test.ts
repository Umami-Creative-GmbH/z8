/**
 * #820: the employee report's CSV, Excel and PDF exports carry a "Custom
 * Fields" section with the report's custom fields, in order.
 */

import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { ReportData } from "../types";
import { exportToCSV } from "./csv-exporter";
import { exportToExcel } from "./excel-exporter";
import { exportToPDF } from "./pdf-exporter";

// Renders the PDF document as HTML text so its content can be read.
vi.mock("@react-pdf/renderer", async () => {
	const { createElement } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const box =
		(tag: string) =>
		({ children }: { children?: unknown }) =>
			createElement(tag, null, children as never);
	return {
		Document: box("div"),
		Page: box("section"),
		View: box("div"),
		Text: box("p"),
		StyleSheet: { create: <T,>(styles: T) => styles },
		pdf: (element: Parameters<typeof renderToStaticMarkup>[0]) => ({
			toBlob: async () => new Blob([renderToStaticMarkup(element)]),
		}),
	};
});

const reportData: ReportData = {
	employee: {
		id: "fictional-employee",
		name: "Fixture User",
		customFields: [
			{ fieldId: "f-po", name: "PO number", type: "text", value: "PN, 7" },
			{ fieldId: "f-start", name: "Start date", type: "date", value: "2024-02-29" },
			{ fieldId: "f-union", name: "Union member", type: "boolean", value: true },
			{ fieldId: "f-tier", name: "Tier", type: "select", value: null },
		],
	},
	period: { startDate: "2026-09-01", endDate: "2026-09-30", label: "September 2026" },
	workHours: { totalHours: 0, totalMinutes: 0, workDays: 0, averagePerDay: 0, byMonth: new Map() },
	absences: {
		totalDays: 0,
		byCategory: new Map(),
		vacation: { approved: 0, pending: 0 },
		sick: { approved: 0, pending: 0 },
		homeOffice: { days: 0, hoursWorked: 0, dateDetails: [] },
		other: { approved: 0, pending: 0 },
	},
	complianceMetrics: { attendancePercentage: 100, overtimeMinutes: 0, underTimeMinutes: 0 },
};

const withoutFields: ReportData = {
	...reportData,
	employee: { ...reportData.employee, customFields: [] },
};

describe("employee report custom fields in exports", () => {
	it("writes a Custom Fields section to the CSV, in order, with dates as ISO dates", () => {
		const lines = exportToCSV(reportData).split("\n");
		const start = lines.indexOf("Custom Fields");
		expect(start).toBeGreaterThan(lines.indexOf("Employee Information"));
		expect(lines.slice(start, start + 5)).toEqual([
			"Custom Fields",
			'PO number,"PN, 7"',
			"Start date,2024-02-29",
			"Union member,Yes",
			"Tier,",
		]);
		expect(exportToCSV(withoutFields)).not.toContain("Custom Fields");
	});

	it("adds the custom fields to the Excel summary sheet", async () => {
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.load(await exportToExcel(reportData));
		const rows: unknown[][] = [];
		workbook
			.getWorksheet("Summary")
			?.eachRow((row) => rows.push([row.getCell(1).value, row.getCell(2).value]));
		const start = rows.findIndex(([label]) => label === "Custom Fields");
		expect(start).toBeGreaterThan(0);
		expect(rows.slice(start + 1, start + 5)).toEqual([
			["PO number", "PN, 7"],
			["Start date", "2024-02-29"],
			["Union member", "Yes"],
			["Tier", ""],
		]);
	});

	it("adds the custom fields to the PDF", async () => {
		const context = {
			generatedAt: "2026-10-02T12:00:00Z",
			locale: "en-US",
			timezone: "UTC",
			timeFormat: "24h" as const,
		};
		const html = new TextDecoder().decode(await exportToPDF(reportData, context));
		expect(html).toContain("Custom Fields");
		expect(html.indexOf("PO number:")).toBeLessThan(html.indexOf("Start date:"));
		expect(html).toContain("2024-02-29");
		expect(html).toContain("Union member:");
		const plain = new TextDecoder().decode(await exportToPDF(withoutFields, context));
		expect(plain).not.toContain("Custom Fields");
	});
});
