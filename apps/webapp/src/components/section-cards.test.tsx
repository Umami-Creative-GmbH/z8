/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, Suspense } from "react";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WIDGET_ORDER } from "@/components/dashboard/widget-registry";
import { queryKeys } from "@/lib/query/keys";

const serverReads = vi.hoisted(() => ({
	layout: vi.fn(),
	widget: vi.fn(),
}));

vi.mock("@/components/dashboard/dashboard-reads", () => ({
	getRenderDashboardLayout: serverReads.layout,
	readDashboardWidget: serverReads.widget,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "user-a",
		organizationId: "org-a",
		role: "manager",
		isLoading: false,
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
	ManagedEmployeesWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Reports ready" : "hydrated widget"}</div>
	),
}));

vi.mock("@/components/dashboard/manager-today-widget", () => ({
	ManagerTodayWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Manager summary ready" : "hydrated widget"}</div>
	),
}));

vi.mock("@/components/dashboard/pending-approvals-widget", () => ({
	PendingApprovalsWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Pending approvals ready" : "hydrated widget"}</div>
	),
}));

vi.mock("@/components/dashboard/presence-status-widget", () => ({
	PresenceStatusWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/quick-stats-widget", () => ({
	QuickStatsWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Work hours ready" : "hydrated widget"}</div>
	),
}));

vi.mock("@/components/dashboard/recently-approved-widget", () => ({
	RecentlyApprovedWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Recent approvals ready" : "hydrated widget"}</div>
	),
}));

vi.mock("@/components/dashboard/team-overview-widget", () => ({
	TeamOverviewWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Organization ready" : "hydrated widget"}</div>
	),
}));

vi.mock("@/components/dashboard/upcoming-shifts-widget", () => ({
	UpcomingShiftsWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Shifts ready" : "hydrated widget"}</div>
	),
}));

vi.mock("@/components/dashboard/upcoming-time-off-widget", () => ({
	UpcomingTimeOffWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Time off ready" : "hydrated widget"}</div>
	),
}));

vi.mock("@/components/dashboard/vacation-balance-widget", () => ({
	VacationBalanceWidget: () => <div>hydrated widget</div>,
}));

vi.mock("@/components/dashboard/whos-out-today-widget", () => ({
	WhosOutTodayWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Out today ready" : "hydrated widget"}</div>
	),
}));
vi.mock("@/components/dashboard/covering-for-widget", () => ({
	CoveringForWidget: ({ initialSnapshot }: { initialSnapshot?: unknown }) => (
		<div>{initialSnapshot ? "Cover ready" : "hydrated widget"}</div>
	),
}));

import { ServerSectionCards } from "./dashboard/server-section-cards";
import { SectionCards } from "./section-cards";

describe("SectionCards", () => {
	it.each([
		["upcoming-shifts", "covering-for", "Cover ready", "Shifts ready"],
		["covering-for", "upcoming-shifts", "Shifts ready", "Cover ready"],
		["whos-out-today", "upcoming-time-off", "Time off ready", "Out today ready"],
		["upcoming-time-off", "whos-out-today", "Out today ready", "Time off ready"],
		["manager-today", "quick-stats", "Work hours ready", "Manager summary ready"],
		["quick-stats", "manager-today", "Manager summary ready", "Work hours ready"],
		["managed-employees", "team-overview", "Organization ready", "Reports ready"],
		["team-overview", "managed-employees", "Reports ready", "Organization ready"],
		["pending-approvals", "recently-approved", "Recent approvals ready", "Pending approvals ready"],
		["recently-approved", "pending-approvals", "Pending approvals ready", "Recent approvals ready"],
	])(
		"streams a completed sibling while %s is still pending",
		async (heldId, readyId, readyContent, pendingContent) => {
			const scope = { userId: "user-a", organizationId: "org-a" };
			serverReads.layout.mockResolvedValue({
				layout: {
					scope,
					settings: {
						dashboardWidgetOrder: {
							order: [heldId, readyId],
							hidden: DEFAULT_WIDGET_ORDER.filter((id) => id !== heldId && id !== readyId),
							version: 1,
						},
					},
					updatedAt: Date.now(),
				},
				subject: {
					...scope,
					employee: {
						id: "employee-a",
						role: "manager",
						organizationId: "org-a",
					},
				},
			});
			let finishManager: (value: unknown) => void = () => {};
			const manager = new Promise((resolve) => {
				finishManager = resolve;
			});
			const snapshot = {
				scope,
				result: { success: true, data: {} },
				updatedAt: Date.now(),
			};
			serverReads.widget.mockImplementation((id: string) =>
				id === heldId ? manager : Promise.resolve(snapshot),
			);
			const client = new QueryClient({
				defaultOptions: { queries: { retry: false } },
			});
			const stream = await renderToReadableStream(
				<QueryClientProvider client={client}>
					<Suspense fallback={<p>Loading Dashboard</p>}>
						<ServerSectionCards />
					</Suspense>
				</QueryClientProvider>,
			);
			const reader = stream.getReader();
			let markup = "";
			try {
				while (!markup.includes(readyContent)) {
					const next = await Promise.race([
						reader.read(),
						new Promise<never>((_, reject) =>
							setTimeout(
								() =>
									reject(
										new Error("Useful sibling did not stream while Manager Today was pending"),
									),
								500,
							),
						),
					]);
					if (next.done) break;
					markup += new TextDecoder().decode(next.value);
				}
				expect(markup).toContain(readyContent);
				expect(markup).not.toContain(pendingContent);
			} finally {
				finishManager(snapshot);
				while (!(await reader.read()).done) {
					/* Drain the completed server stream. */
				}
			}
		},
	);

	it("renders server-provided visible widget slots without a hydration or settings request prerequisite", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const markup = renderToString(
			<QueryClientProvider client={queryClient}>
				<SectionCards
					initialLayout={{
						scope: { userId: "user-a", organizationId: "org-a" },
						settings: {
							dashboardWidgetOrder: {
								order: ["quick-stats", "manager-today"],
								hidden: DEFAULT_WIDGET_ORDER.filter(
									(id) => id !== "quick-stats" && id !== "manager-today",
								),
								version: 1,
							},
						},
						updatedAt: 1234,
					}}
					widgetSlots={{
						"manager-today": <div>Manager summary ready</div>,
						"quick-stats": <div>Work hours ready</div>,
					}}
				/>
			</QueryClientProvider>,
		);

		expect(markup).toContain("Manager summary ready");
		expect(markup).toContain("Work hours ready");
		expect(markup.indexOf("Work hours ready")).toBeLessThan(
			markup.indexOf("Manager summary ready"),
		);
		expect(markup).not.toContain("animate-pulse");
	});

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
		expect(markup).not.toContain('data-widget-id="managed-employees"');
	});
});
