/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
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

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@tabler/icons-react", () => ({
	IconCalendarOff: () => <span aria-hidden="true" />,
	IconCheck: () => <span aria-hidden="true" />,
	IconClock: () => <span aria-hidden="true" />,
	IconLoader2: () => <span aria-hidden="true" />,
	IconUsers: () => <span aria-hidden="true" />,
}));

vi.mock("@/components/analytics/export-button", () => ({
	ExportButton: ({ disabled }: { disabled: boolean }) => (
		<button type="button" disabled={disabled}>
			Export
		</button>
	),
}));

vi.mock("@/components/analytics/date-range-picker", () => ({
	AnalyticsDateRangePicker: ({
		onChange,
	}: {
		onChange: (dateRange: { start: Date; end: Date }) => void;
	}) => (
		<button
			type="button"
			onClick={() =>
				onChange({ start: new Date("2026-05-01"), end: new Date("2026-05-31") })
			}
		>
			Change range
		</button>
	),
}));

vi.mock("@/components/ui/chart", () => ({
	ChartContainer: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	ChartTooltip: () => null,
	ChartTooltipContent: () => null,
}));

vi.mock("./actions", () => ({
	getAbsencePatternsData: getAbsencePatternsDataMock,
	getManagerEffectivenessData: getManagerEffectivenessDataMock,
	getTeamPerformanceData: getTeamPerformanceDataMock,
}));

import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import AnalyticsOverviewPage from "./page";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: () => {} }),
}));

function RefreshControl() {
	const { refresh } = useViewRefreshAction();
	return (
		<button type="button" onClick={refresh}>
			Refresh data
		</button>
	);
}

function renderWithRefresh() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<ViewRefreshProvider>
				<RefreshControl />
				<AnalyticsOverviewPage />
			</ViewRefreshProvider>
		</QueryClientProvider>,
	);
}

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
		byType: [
			{ categoryName: "Vacation", count: 1, totalDays, percentage: 100 },
		],
		byTeam: [],
		patterns: {
			sickLeavePatterns: {
				avgDuration: 0,
				peakMonths: [],
				frequentEmployees: [],
			},
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
	return Promise.withResolvers<T>();
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
			within(screen.getByRole("list", { name: "By Manager" })).getAllByRole(
				"listitem",
			),
		).toHaveLength(1);
		expect(
			within(screen.getByRole("list", { name: "By Team" })).getAllByRole(
				"listitem",
			),
		).toHaveLength(1);
	});

	it("keeps team and absence analytics visible when manager analytics rejects", async () => {
		getManagerEffectivenessDataMock.mockRejectedValueOnce(
			new Error("Manager analytics failed"),
		);

		render(<AnalyticsOverviewPage />);

		await waitFor(() => {
			expect(screen.getByText("160.0h")).toBeTruthy();
			expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(2);
			expect(screen.getByText("Unavailable")).toBeTruthy();
			expect(
				screen.getByText("Approval analytics could not be loaded"),
			).toBeTruthy();
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
		expect(
			screen.queryByText("Approval analytics could not be loaded"),
		).toBeNull();
	});

	it("distinguishes failed team and absence reads from successful zero approval data", async () => {
		render(<AnalyticsOverviewPage />);

		await screen.findByText("Operations approvals");
		expect(screen.getByText("87.5%")).toBeTruthy();

		getTeamPerformanceDataMock.mockResolvedValueOnce({
			success: false,
			error: "Team failed",
		});
		getAbsencePatternsDataMock.mockResolvedValueOnce({
			success: false,
			error: "Absence failed",
		});
		getManagerEffectivenessDataMock.mockResolvedValueOnce({
			success: true,
			data: createManagerData({ approvalRate: 0, withBottlenecks: false }),
		});

		fireEvent.click(screen.getByRole("button", { name: "Change range" }));

		await waitFor(() => {
			expect(screen.getAllByText("Unavailable")).toHaveLength(3);
			expect(screen.getByText("No approval bottlenecks found")).toBeTruthy();
		});
		expect(screen.queryByText("Operations approvals")).toBeNull();
		expect(screen.queryByText("0.0h")).toBeNull();
		expect(screen.queryByText("No data available")).toBeNull();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to load analytics data",
		);
	});

	it("ignores stale responses when the date range changes before older requests finish", async () => {
		const firstTeam = deferred<{
			success: true;
			data: ReturnType<typeof createTeamData>;
		}>();
		const firstAbsence = deferred<{
			success: true;
			data: ReturnType<typeof createAbsenceData>;
		}>();
		const firstManager = deferred<{
			success: true;
			data: ReturnType<typeof createManagerData>;
		}>();

		getTeamPerformanceDataMock
			.mockReturnValueOnce(firstTeam.promise)
			.mockResolvedValueOnce({
				success: true,
				data: createTeamData("Current Team", 500),
			});
		getAbsencePatternsDataMock
			.mockReturnValueOnce(firstAbsence.promise)
			.mockResolvedValueOnce({ success: true, data: createAbsenceData(4) });
		getManagerEffectivenessDataMock
			.mockReturnValueOnce(firstManager.promise)
			.mockResolvedValueOnce({
				success: true,
				data: createManagerData({
					approvalRate: 91.2,
					teamLabel: "Current approvals",
				}),
			});

		render(<AnalyticsOverviewPage />);
		await waitFor(() =>
			expect(getManagerEffectivenessDataMock).toHaveBeenCalledTimes(1),
		);
		fireEvent.click(screen.getByRole("button", { name: "Change range" }));

		await screen.findByText("Current approvals");
		expect(screen.getByText("91.2%")).toBeTruthy();

		firstTeam.resolve({
			success: true,
			data: createTeamData("Stale Team", 100),
		});
		firstAbsence.resolve({ success: true, data: createAbsenceData(8) });
		firstManager.resolve({
			success: true,
			data: createManagerData({
				approvalRate: 55.5,
				teamLabel: "Stale approvals",
			}),
		});

		await waitFor(() => {
			expect(screen.queryByText("Stale approvals")).toBeNull();
		});
		expect(screen.getByText("Current approvals")).toBeTruthy();
		expect(screen.getByText("91.2%")).toBeTruthy();
	});

	it("keeps the selected period and usable records during refresh, then retries a partial failure", async () => {
		renderWithRefresh();
		await screen.findByText("160.0h");
		fireEvent.click(screen.getByRole("button", { name: "Change range" }));
		await screen.findByText("160.0h");
		const held = deferred<{ success: false; error: string }>();
		getTeamPerformanceDataMock.mockReturnValueOnce(held.promise);
		getAbsencePatternsDataMock.mockResolvedValueOnce({
			success: true,
			data: createAbsenceData(5),
		});
		fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
		await screen.findByText("Refreshing analytics…");
		expect(screen.getByText("160.0h")).toBeTruthy();
		held.resolve({ success: false, error: "Temporary read failure" });
		await screen.findByRole("button", { name: "Retry" });
		expect(screen.getByText("160.0h")).toBeTruthy();
		expect(screen.getByText("5")).toBeTruthy();
		getTeamPerformanceDataMock.mockResolvedValueOnce({
			success: true,
			data: createTeamData("Recovered", 400),
		});
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("200.0h");
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(
			getTeamPerformanceDataMock.mock.lastCall?.[0].start.toISOString(),
		).toBe("2026-05-01T00:00:00.000Z");
	});

	it("removes cached records after authority loss on refresh", async () => {
		renderWithRefresh();
		await screen.findByText("160.0h");
		getTeamPerformanceDataMock.mockResolvedValueOnce({
			success: false,
			code: "AuthorizationError",
			error: "Access revoked",
		});
		fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
		await screen.findByRole("button", { name: "Retry" });
		expect(screen.queryByText("160.0h")).toBeNull();
		expect(screen.getAllByText("Unavailable")).toHaveLength(4);
	});

	it("does not render previous organization records when the active organization changes in flight", async () => {
		const first = deferred<{
			success: true;
			data: ReturnType<typeof createTeamData>;
		}>();
		getTeamPerformanceDataMock
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce({
				success: true,
				data: createTeamData("New organization", 400),
			});
		render(<AnalyticsOverviewPage />);
		await waitFor(() =>
			expect(getTeamPerformanceDataMock).toHaveBeenCalledTimes(1),
		);
		act(() =>
			useOrganizationSettings
				.getState()
				.setSettings({ organizationId: "org-2" }),
		);
		await screen.findByText("200.0h");
		first.resolve({
			success: true,
			data: createTeamData("Old organization", 100),
		});
		await act(async () => {
			await first.promise;
		});
		expect(screen.queryByText("50.0h")).toBeNull();
		expect(screen.getByText("200.0h")).toBeTruthy();
	});

	it("cannot export the previous period's team dataset while a new period is pending", async () => {
		render(<AnalyticsOverviewPage />);
		await screen.findByText("160.0h");
		expect(
			screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
		).toBe(false);
		const held = deferred<{
			success: true;
			data: ReturnType<typeof createTeamData>;
		}>();
		getTeamPerformanceDataMock.mockReturnValueOnce(held.promise);
		fireEvent.click(screen.getByRole("button", { name: "Change range" }));
		expect(
			screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
		).toBe(true);
		held.resolve({ success: true, data: createTeamData("New period", 400) });
		await screen.findByText("200.0h");
		expect(
			screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
		).toBe(false);
	});

	it("recovers a failed arrival without presenting any unavailable dataset as zero", async () => {
		getTeamPerformanceDataMock.mockRejectedValueOnce(new Error("Offline"));
		getAbsencePatternsDataMock.mockRejectedValueOnce(new Error("Offline"));
		getManagerEffectivenessDataMock.mockRejectedValueOnce(new Error("Offline"));
		render(<AnalyticsOverviewPage />);
		await screen.findByRole("button", { name: "Retry" });
		expect(screen.getAllByText("Unavailable")).toHaveLength(4);
		expect(screen.queryByText("0.0h")).toBeNull();
		expect(screen.queryByText("No approval bottlenecks found")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("160.0h");
		expect(screen.queryByText("Unavailable")).toBeNull();
	});
});
