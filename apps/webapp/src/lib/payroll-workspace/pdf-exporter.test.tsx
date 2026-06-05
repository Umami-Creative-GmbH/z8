import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { exportPayrollSummaryToPDF, generatePayrollPDFFilename } from "./pdf-exporter";
import type { PayrollWorkspaceSummary } from "./types";

const summary: PayrollWorkspaceSummary = {
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
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
			absenceDaysByCategory: [{ categoryId: "vacation", categoryName: "Vacation", days: 2 }],
			hasBlockers: true,
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
	it("generates a stable filename", () => {
		expect(generatePayrollPDFFilename(summary)).toBe("payroll-acme-gmbh-2026-06-01-2026-06-30.pdf");
	});

	it("generates a PDF byte array", async () => {
		const pdf = await exportPayrollSummaryToPDF(summary);
		expect(pdf.byteLength).toBeGreaterThan(1000);
	});
});
