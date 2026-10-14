// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HourlyEarningsData, ReportData } from "@/lib/reports/types";
import { ReportSummaryCards } from "./report-summary-cards";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

afterEach(cleanup);

function reportData(
	contractType: "fixed" | "hourly",
	hourlyEarnings?: HourlyEarningsData,
): ReportData {
	return {
		employee: { id: "employee-1", name: "Ada", contractType, customFields: [] },
		period: { startDate: "2026-03-01", endDate: "2026-03-31", label: "March 2026" },
		workHours: {
			totalHours: 8,
			totalMinutes: 480,
			workDays: 1,
			averagePerDay: 8,
			byMonth: new Map(),
		},
		absences: {
			totalDays: 0,
			byCategory: new Map(),
			vacation: { approved: 0, pending: 0 },
			sick: { approved: 0, pending: 0 },
			homeOffice: { days: 0, hoursWorked: 0, dateDetails: [] },
			other: { approved: 0, pending: 0 },
		},
		complianceMetrics: { attendancePercentage: 100, overtimeMinutes: 0, underTimeMinutes: 0 },
		hourlyEarnings,
	};
}

const earnings: HourlyEarningsData = {
	totalHours: 8,
	totalEarnings: 200,
	currency: "EUR",
	byRatePeriod: [
		{
			rate: 25,
			currency: "EUR",
			periodStart: "2026-03-01",
			periodEnd: "2026-03-14",
			hours: 8,
			earnings: 200,
		},
	],
};

describe("ReportSummaryCards", () => {
	it("shows earnings for an employee who is fixed now but worked under hourly terms", () => {
		render(<ReportSummaryCards reportData={reportData("fixed", earnings)} />);

		expect(screen.getByText("Total Earnings")).toBeTruthy();
	});

	it("shows no earnings when no hourly terms were in force", () => {
		render(<ReportSummaryCards reportData={reportData("hourly")} />);

		expect(screen.queryByText("Total Earnings")).toBeNull();
	});
});
