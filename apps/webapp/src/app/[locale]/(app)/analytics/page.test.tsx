/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAbsencePatternsDataMock, getManagerEffectivenessDataMock, getTeamPerformanceDataMock } =
	vi.hoisted(() => ({
		getAbsencePatternsDataMock: vi.fn(),
		getManagerEffectivenessDataMock: vi.fn(),
		getTeamPerformanceDataMock: vi.fn(),
	}));

vi.mock("next/dynamic", () => ({
	default: () =>
		function DynamicChartMock({ children }: { children?: React.ReactNode }) {
			return <div data-testid="dynamic-chart">{children}</div>;
		},
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
	},
}));

vi.mock("@tabler/icons-react", () => ({
	IconCalendarOff: () => <span aria-hidden="true" />,
	IconCheck: () => <span aria-hidden="true" />,
	IconClock: () => <span aria-hidden="true" />,
	IconLoader2: () => <span aria-hidden="true" />,
	IconUsers: () => <span aria-hidden="true" />,
}));

vi.mock("@/components/analytics/export-button", () => ({
	ExportButton: () => <button type="button">Export</button>,
}));

vi.mock("@/components/reports/date-range-picker", () => ({
	DateRangePicker: () => <button type="button">Current month</button>,
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
	CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
	CardHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
	CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/chart", () => ({
	ChartContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ChartTooltip: () => null,
	ChartTooltipContent: () => null,
}));

vi.mock("./actions", () => ({
	getAbsencePatternsData: getAbsencePatternsDataMock,
	getManagerEffectivenessData: getManagerEffectivenessDataMock,
	getTeamPerformanceData: getTeamPerformanceDataMock,
}));

import AnalyticsOverviewPage from "./page";

describe("AnalyticsOverviewPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getTeamPerformanceDataMock.mockResolvedValue({
			success: true,
			data: {
				teams: [
					{
						teamId: "team-1",
						teamName: "Operations",
						totalHours: 320,
						avgHoursPerEmployee: 160,
						employeeCount: 2,
						employees: [],
					},
				],
				organizationTotal: 320,
				dateRange: { start: new Date("2026-04-01"), end: new Date("2026-04-30") },
			},
		});
		getAbsencePatternsDataMock.mockResolvedValue({
			success: true,
			data: {
				summary: {
					totalAbsences: 1,
					totalDays: 2,
					avgDaysPerAbsence: 2,
					absenceRate: 1,
				},
				byType: [{ categoryName: "Vacation", count: 1, totalDays: 2, percentage: 100 }],
				byTeam: [],
				patterns: {
					sickLeavePatterns: { avgDuration: 0, peakMonths: [], frequentEmployees: [] },
					vacationClustering: { score: 0, hotspots: [] },
				},
				timeline: [],
			},
		});
		getManagerEffectivenessDataMock.mockResolvedValue({
			success: true,
			data: {
				approvalMetrics: {
					avgResponseTime: 12,
					avgDecisionTimeHours: 18,
					totalApprovals: 7,
					totalRejections: 1,
					approvalRate: 87.5,
					pendingSlaWarnings: 3,
				},
				byManager: [],
				byTeam: [
					{
						id: "team-ops",
						label: "Operations approvals",
						approvedCount: 5,
						rejectedCount: 1,
						pendingCount: 4,
						pendingSlaWarnings: 2,
						avgDecisionTimeHours: 22,
						approvalRate: 83.3,
					},
				],
				byType: [
					{
						id: "vacation",
						label: "Vacation",
						approvedCount: 2,
						rejectedCount: 0,
						pendingCount: 1,
						pendingSlaWarnings: 1,
						avgDecisionTimeHours: 10,
						approvalRate: 100,
					},
				],
				responseTimeDistribution: [],
				trends: [],
			},
		});
	});

	it("renders real approval analytics and bottlenecks", async () => {
		render(<AnalyticsOverviewPage />);

		await waitFor(() => {
			expect(getManagerEffectivenessDataMock).toHaveBeenCalledTimes(1);
		});
		expect(screen.getByText("87.5%")).toBeTruthy();
		expect(screen.getByText("Of decided requests approved")).toBeTruthy();
		expect(screen.getByText("Approval Bottlenecks")).toBeTruthy();
		expect(screen.getByText("Operations approvals")).toBeTruthy();
	});
});
