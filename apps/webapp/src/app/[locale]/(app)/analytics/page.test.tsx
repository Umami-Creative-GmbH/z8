/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getManagerEffectivenessDataMock,
	toastErrorMock,
	getAuthContextMock,
	getCurrentSettingsAccessMock,
	getStatisticsScopeMock,
	getAttentionStatisticsMock,
	getMonthStatisticsMock,
	getAdoptionStatisticsMock,
	getWorkforceStatisticsMock,
	loadApprovalInboxSummaryMock,
} = vi.hoisted(() => ({
	getManagerEffectivenessDataMock: vi.fn(),
	toastErrorMock: vi.fn(),
	getAuthContextMock: vi.fn(),
	getCurrentSettingsAccessMock: vi.fn(),
	getStatisticsScopeMock: vi.fn(),
	getAttentionStatisticsMock: vi.fn(),
	getMonthStatisticsMock: vi.fn(),
	getAdoptionStatisticsMock: vi.fn(),
	getWorkforceStatisticsMock: vi.fn(),
	loadApprovalInboxSummaryMock: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
	},
}));

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

vi.mock("@/components/analytics/date-range-picker", () => ({
	AnalyticsDateRangePicker: ({
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

vi.mock("./actions", () => ({
	getManagerEffectivenessData: getManagerEffectivenessDataMock,
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: getAuthContextMock,
	getCurrentSettingsAccess: getCurrentSettingsAccessMock,
}));

vi.mock("../settings/statistics/actions", () => ({
	getStatisticsScope: getStatisticsScopeMock,
	getAttentionStatistics: getAttentionStatisticsMock,
	getMonthStatistics: getMonthStatisticsMock,
	getAdoptionStatistics: getAdoptionStatisticsMock,
	getWorkforceStatistics: getWorkforceStatisticsMock,
}));

vi.mock("../settings/statistics/approval-inbox-summary", () => ({
	loadApprovalInboxSummary: loadApprovalInboxSummaryMock,
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: () => {} }),
}));

import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { AnalyticsHealthSections } from "./analytics-health-sections";
import { AnalyticsOverviewBottlenecks } from "./analytics-overview-bottlenecks";

function RefreshControl() {
	const { refresh } = useViewRefreshAction();
	return (
		<button type="button" onClick={refresh}>
			Refresh data
		</button>
	);
}

function renderBottlenecks() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<ViewRefreshProvider>
				<RefreshControl />
				<AnalyticsOverviewBottlenecks />
			</ViewRefreshProvider>
		</QueryClientProvider>,
	);
}

function hydrateOrganizationSettings(organizationId = "org-1", timezone = "UTC") {
	act(() => {
		useOrganizationSettings.getState().hydrate({
			organizationId,
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			timezone,
			deletedAt: null,
		});
	});
}

function createManagerData({
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
			approvalRate: 87.5,
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

describe("AnalyticsOverviewBottlenecks (#1955)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useOrganizationSettings.getState().reset();
		hydrateOrganizationSettings();
	});

	it("renders Approval Bottlenecks without duplicated KPI cards or Work Hours / Absence charts", async () => {
		getManagerEffectivenessDataMock.mockResolvedValue({
			success: true,
			data: createManagerData(),
		});

		renderBottlenecks();

		expect(await screen.findByText("Approval Bottlenecks")).toBeTruthy();
		expect(screen.getByText("Avery Manager")).toBeTruthy();
		expect(screen.getByText("Operations approvals")).toBeTruthy();
		expect(screen.getByText("Vacation")).toBeTruthy();
		expect(screen.queryByText("Total Employees")).toBeNull();
		expect(screen.queryByText("Avg Work Hours")).toBeNull();
		expect(screen.queryByText("Work Hours by Team")).toBeNull();
		expect(screen.queryByText("Absence Patterns")).toBeNull();
	});

	it("shows unavailable state and retry when approval bottlenecks fail", async () => {
		getManagerEffectivenessDataMock.mockResolvedValue({
			success: false,
			error: "Temporary outage",
		});

		renderBottlenecks();

		expect(await screen.findByText("Approval bottlenecks could not be loaded")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

		getManagerEffectivenessDataMock.mockResolvedValue({
			success: true,
			data: createManagerData({ withBottlenecks: false }),
		});
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("No approval bottlenecks found")).toBeTruthy();
	});

	it("retains loaded bottlenecks on transient background refresh failure and clears them on authority refusal", async () => {
		getManagerEffectivenessDataMock.mockResolvedValue({
			success: true,
			data: createManagerData(),
		});

		renderBottlenecks();
		expect(await screen.findByText("Avery Manager")).toBeTruthy();

		getManagerEffectivenessDataMock.mockResolvedValue({
			success: false,
			error: "Transient timeout",
		});
		fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
		await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
		expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(false),
		);
		expect(screen.getByText("Avery Manager")).toBeTruthy();

		getManagerEffectivenessDataMock.mockResolvedValue({
			success: false,
			code: "AuthorizationError",
			error: "Forbidden",
		});
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("Approval bottlenecks could not be loaded")).toBeTruthy();
		expect(screen.queryByText("Avery Manager")).toBeNull();
	});

	it("resets bottlenecks when switching organizations", async () => {
		getManagerEffectivenessDataMock.mockResolvedValueOnce({
			success: true,
			data: createManagerData({ managerName: "Org One Manager" }),
		});

		renderBottlenecks();
		expect(await screen.findByText("Org One Manager")).toBeTruthy();

		getManagerEffectivenessDataMock.mockResolvedValueOnce({
			success: true,
			data: createManagerData({ managerName: "Org Two Manager" }),
		});
		hydrateOrganizationSettings("org-2");

		expect(await screen.findByText("Org Two Manager")).toBeTruthy();
		expect(screen.queryByText("Org One Manager")).toBeNull();
	});
});

describe("AnalyticsHealthSections (#1955)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getAuthContextMock.mockResolvedValue({
			user: { id: "user-admin" },
			session: { activeOrganizationId: "org-1" },
			employee: null,
		});
		getCurrentSettingsAccessMock.mockResolvedValue({
			userId: "user-admin",
			organizationId: "org-1",
			employee: null,
			settingsAccess: "orgAdmin",
			membershipRole: "admin",
		});
		getStatisticsScopeMock.mockResolvedValue({
			success: true,
			data: {
				scope: { organizationWide: true },
				fetchedAt: "2026-03-15T10:00:00.000Z",
			},
		});
		getAttentionStatisticsMock.mockResolvedValue({
			success: true,
			data: {
				staleLiveWork: { status: "ok", value: 2 },
				openViolations: { status: "ok", value: 1 },
			},
		});
		loadApprovalInboxSummaryMock.mockResolvedValue({
			status: "ok",
			value: null,
		});
		getMonthStatisticsMock.mockResolvedValue({
			success: true,
			data: {
				comparison: { firstDay: "2026-02-01", lastDay: "2026-02-15" },
				workedMinutes: { status: "ok", value: { current: 600, previous: 480 } },
				absenceDays: { status: "ok", value: { current: 2, previous: 1 } },
				completedWorkPeriods: {
					status: "ok",
					value: { current: 10, previous: 8 },
				},
			},
		});
		getAdoptionStatisticsMock.mockResolvedValue({
			success: true,
			data: {
				coverage: { status: "ok", value: { tracked: 8, expected: 10 } },
				clockedIn: { status: "ok", value: 3 },
				manualEntryShare: {
					status: "ok",
					value: { manualMinutes: 60, totalMinutes: 600 },
				},
			},
		});
		getWorkforceStatisticsMock.mockResolvedValue({
			success: true,
			data: {
				roster: { status: "ok", value: { roster: 12, joined: 2, left: 1 } },
				teams: { status: "ok", value: 4 },
				incompleteSetup: { status: "ok", value: 1 },
				usersSignedIn: { status: "ok", value: 7 },
			},
		});
	});

	it("renders Needs attention, This month, Tracking adoption, and Workforce & setup for an employee-less org admin", async () => {
		const container = await AnalyticsHealthSections();
		expect(container).not.toBeNull();
		if (!container) return;

		// Resolve each Suspense child section element so we inspect the real rendered sections.
		const sections = container.props.children as Array<{
			props: {
				children: {
					type: (props: Record<string, unknown>) => Promise<React.ReactElement>;
					props: Record<string, unknown>;
				};
			};
		}>;
		const rendered = await Promise.all(
			sections.map(async (suspense) => {
				const child = suspense.props.children;
				return renderToStaticMarkup(await child.type(child.props));
			}),
		);
		const combinedHtml = rendered.join("\n");

		expect(combinedHtml).toContain("Needs attention");
		expect(combinedHtml).toContain("This month");
		expect(combinedHtml).toContain("Tracking adoption");
		expect(combinedHtml).toContain("Workforce &amp; setup");
		expect(combinedHtml).toContain("Stale live work");
		expect(combinedHtml).toContain("Users signed in");
	});
});
