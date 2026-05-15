/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getAbsencePatternsDataMock,
	getManagerEffectivenessDataMock,
	getTeamPerformanceDataMock,
	toastErrorMock,
} = vi.hoisted(() => ({
	getAbsencePatternsDataMock: vi.fn(),
	getManagerEffectivenessDataMock: vi.fn(),
	getTeamPerformanceDataMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
	default: () =>
		function DynamicChartMock({ children }: { children?: React.ReactNode }) {
			return <div data-testid="dynamic-chart">{children}</div>;
		},
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
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
import { useOrganizationSettings } from "@/stores/organization-settings-store";

function hydrateOrganizationSettings(timezone = "UTC") {
	act(() => {
		useOrganizationSettings.getState().hydrate({
			organizationId: "org-1",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			timezone,
			deletedAt: null,
		});
	});
}

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
	managerName = "Avery Manager",
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
		byManager: withBottlenecks
			? [
					{
						managerId: "manager-1",
						managerName,
						avgResponseTime: 8,
						avgDecisionTimeHours: 14,
						totalApprovals: 4,
						totalRejections: 1,
						approvalRate: 80,
						teamSize: 6,
						pendingCount: 3,
						pendingSlaWarnings: 1,
					},
				]
			: [],
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
		useOrganizationSettings.getState().reset();
		hydrateOrganizationSettings();
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

	it("does not fetch analytics before organization settings hydrate", () => {
		useOrganizationSettings.getState().reset();

		render(<AnalyticsOverviewPage />);

		expect(getTeamPerformanceDataMock).not.toHaveBeenCalled();
		expect(getAbsencePatternsDataMock).not.toHaveBeenCalled();
		expect(getManagerEffectivenessDataMock).not.toHaveBeenCalled();
	});

	it("renders real approval analytics and bottlenecks", async () => {
		render(<AnalyticsOverviewPage />);

		await waitFor(() => {
			expect(getManagerEffectivenessDataMock).toHaveBeenCalledTimes(1);
		});
		expect(screen.getByText("87.5%")).toBeTruthy();
		expect(screen.getByText("Of decided requests approved")).toBeTruthy();
		expect(screen.getByText("Approval Bottlenecks")).toBeTruthy();
		expect(screen.getByText("Avery Manager")).toBeTruthy();
		expect(screen.getByText("Operations approvals")).toBeTruthy();
		expect(
			within(screen.getByRole("list", { name: "By Manager" })).getAllByRole("listitem"),
		).toHaveLength(1);
		expect(
			within(screen.getByRole("list", { name: "By Team" })).getAllByRole("listitem"),
		).toHaveLength(1);
	});

	it("keeps team and absence analytics visible when manager analytics rejects", async () => {
		getManagerEffectivenessDataMock.mockRejectedValueOnce(new Error("Manager analytics failed"));

		render(<AnalyticsOverviewPage />);

		await waitFor(() => {
			expect(screen.getByText("160.0h")).toBeTruthy();
			expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(2);
			expect(screen.getByText("Unavailable")).toBeTruthy();
			expect(screen.getByText("Approval analytics could not be loaded")).toBeTruthy();
		});
		expect(screen.queryByText("0.0%")).toBeNull();
		expect(screen.queryByText("No approval bottlenecks found")).toBeNull();
		expect(screen.queryByText("Avery Manager")).toBeNull();
		expect(screen.queryByText("No data available")).toBeNull();
	});

	it("shows normal empty bottlenecks when manager analytics succeeds with no bottlenecks", async () => {
		getManagerEffectivenessDataMock.mockResolvedValueOnce({
			success: true,
			data: createManagerData({ approvalRate: 0, withBottlenecks: false }),
		});

		render(<AnalyticsOverviewPage />);

		await waitFor(() => {
			expect(screen.getByText("0.0%")).toBeTruthy();
			expect(screen.getByText("No approval bottlenecks found")).toBeTruthy();
		});
		expect(screen.queryByText("Approval analytics could not be loaded")).toBeNull();
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
		expect(toastErrorMock).toHaveBeenCalledWith("Failed to load analytics data");
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
