/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
	DateRangePicker: ({
		onChange,
	}: {
		onChange: (dateRange: { start: Date; end: Date }) => void;
	}) => (
		<button
			type="button"
			onClick={() => onChange({ start: new Date("2026-05-01"), end: new Date("2026-05-31") })}
		>
			Change range
		</button>
	),
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

function createTeamData(teamName = "Operations", totalHours = 320) {
	return {
		teams: [
			{
				teamId: `team-${teamName}`,
				teamName,
				totalHours,
				avgHoursPerEmployee: totalHours / 2,
				employeeCount: 2,
				employees: [],
			},
		],
		organizationTotal: totalHours,
		dateRange: { start: new Date("2026-04-01"), end: new Date("2026-04-30") },
	};
}

function createAbsenceData(totalDays = 2) {
	return {
		summary: {
			totalAbsences: 1,
			totalDays,
			avgDaysPerAbsence: totalDays,
			absenceRate: 1,
		},
		byType: [{ categoryName: "Vacation", count: 1, totalDays, percentage: 100 }],
		byTeam: [],
		patterns: {
			sickLeavePatterns: { avgDuration: 0, peakMonths: [], frequentEmployees: [] },
			vacationClustering: { score: 0, hotspots: [] },
		},
		timeline: [],
	};
}

function createManagerData({
	approvalRate = 87.5,
	teamLabel = "Operations approvals",
	withBottlenecks = true,
} = {}) {
	return {
		approvalMetrics: {
			avgResponseTime: 12,
			avgDecisionTimeHours: 18,
			totalApprovals: 7,
			totalRejections: 1,
			approvalRate,
			pendingSlaWarnings: 3,
		},
		byManager: [],
		byTeam: withBottlenecks
			? [
					{
						id: "team-ops",
						label: teamLabel,
						approvedCount: 5,
						rejectedCount: 1,
						pendingCount: 4,
						pendingSlaWarnings: 2,
						avgDecisionTimeHours: 22,
						approvalRate: 83.3,
					},
				]
			: [],
		byType: withBottlenecks
			? [
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
				]
			: [],
		responseTimeDistribution: [],
		trends: [],
	};
}

function deferred<T>() {
	let resolve: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve: resolve! };
}

describe("AnalyticsOverviewPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getTeamPerformanceDataMock.mockResolvedValue({
			success: true,
			data: createTeamData(),
		});
		getAbsencePatternsDataMock.mockResolvedValue({
			success: true,
			data: createAbsenceData(),
		});
		getManagerEffectivenessDataMock.mockResolvedValue({
			success: true,
			data: createManagerData(),
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
		expect(
			within(screen.getByRole("list", { name: "By Team" })).getAllByRole("listitem"),
		).toHaveLength(1);
	});

	it("clears failed datasets and shows empty bottlenecks when analytics fail", async () => {
		render(<AnalyticsOverviewPage />);

		await screen.findByText("Operations approvals");
		expect(screen.getByText("87.5%")).toBeTruthy();

		getTeamPerformanceDataMock.mockResolvedValueOnce({ success: false, error: "Team failed" });
		getAbsencePatternsDataMock.mockResolvedValueOnce({ success: false, error: "Absence failed" });
		getManagerEffectivenessDataMock.mockResolvedValueOnce({
			success: true,
			data: createManagerData({ approvalRate: 0, withBottlenecks: false }),
		});

		fireEvent.click(screen.getByRole("button", { name: "Change range" }));

		await waitFor(() => {
			expect(screen.getByText("0.0h")).toBeTruthy();
			expect(screen.getByText("No approval bottlenecks found")).toBeTruthy();
		});
		expect(screen.queryByText("Operations approvals")).toBeNull();
		expect(screen.getAllByText("No data available")).toHaveLength(2);
	});

	it("ignores stale responses when the date range changes before older requests finish", async () => {
		const firstTeam = deferred<{ success: true; data: ReturnType<typeof createTeamData> }>();
		const firstAbsence = deferred<{ success: true; data: ReturnType<typeof createAbsenceData> }>();
		const firstManager = deferred<{ success: true; data: ReturnType<typeof createManagerData> }>();

		getTeamPerformanceDataMock
			.mockReturnValueOnce(firstTeam.promise)
			.mockResolvedValueOnce({ success: true, data: createTeamData("Current Team", 500) });
		getAbsencePatternsDataMock
			.mockReturnValueOnce(firstAbsence.promise)
			.mockResolvedValueOnce({ success: true, data: createAbsenceData(4) });
		getManagerEffectivenessDataMock
			.mockReturnValueOnce(firstManager.promise)
			.mockResolvedValueOnce({
				success: true,
				data: createManagerData({ approvalRate: 91.2, teamLabel: "Current approvals" }),
			});

		render(<AnalyticsOverviewPage />);
		fireEvent.click(screen.getByRole("button", { name: "Change range" }));

		await screen.findByText("Current approvals");
		expect(screen.getByText("91.2%")).toBeTruthy();

		firstTeam.resolve({ success: true, data: createTeamData("Stale Team", 100) });
		firstAbsence.resolve({ success: true, data: createAbsenceData(8) });
		firstManager.resolve({
			success: true,
			data: createManagerData({ approvalRate: 55.5, teamLabel: "Stale approvals" }),
		});

		await waitFor(() => {
			expect(screen.queryByText("Stale approvals")).toBeNull();
		});
		expect(screen.getByText("Current approvals")).toBeTruthy();
		expect(screen.getByText("91.2%")).toBeTruthy();
	});
});
