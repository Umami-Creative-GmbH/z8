/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/components/dashboard/sortable-widget-grid", () => ({
	SortableWidgetGrid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/dashboard/dashboard-widget", () => ({
	DashboardWidget: ({ id, children }: { id: string; children: ReactNode }) => (
		<div data-widget-id={id}>{children}</div>
	),
}));

vi.mock("@/components/dashboard/actions", () => ({
	getUserSettings: vi.fn(),
	updateWidgetOrder: vi.fn(),
}));

vi.mock("@/components/dashboard/birthday-reminders-widget", () => ({
	BirthdayRemindersWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/hydration-widget", () => ({
	HydrationWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/managed-employees-widget", () => ({
	ManagedEmployeesWidget: () => <div data-widget-id="managed-employees">hydrated widget</div>,
}));

vi.mock("@/components/dashboard/manager-today-widget", () => ({
	ManagerTodayWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/pending-approvals-widget", () => ({
	PendingApprovalsWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/presence-status-widget", () => ({
	PresenceStatusWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/quick-stats-widget", () => ({
	QuickStatsWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/recently-approved-widget", () => ({
	RecentlyApprovedWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/team-overview-widget", () => ({
	TeamOverviewWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/upcoming-time-off-widget", () => ({
	UpcomingTimeOffWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/vacation-balance-widget", () => ({
	VacationBalanceWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/whos-out-today-widget", () => ({
	WhosOutTodayWidget: () => <div>hydrated widget</div>,
}));

import { SectionCards } from "./section-cards";

describe("SectionCards", () => {
	it("keeps server markup on the skeleton while widget settings may already be cached on the client", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(queryKeys.dashboard.widgetOrder(), {
			dashboardWidgetOrder: {
				order: ["managed-employees"],
				hidden: [],
				version: 1,
			},
		});

		const markup = renderToString(
			<QueryClientProvider client={queryClient}>
				<SectionCards />
			</QueryClientProvider>,
		);

		expect(markup).toContain("animate-pulse");
		expect(markup).not.toContain("data-widget-id=\"managed-employees\"");
	});
});
