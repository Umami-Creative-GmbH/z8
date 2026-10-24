/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SERVER_WIDGET_IDS,
	type ServerWidgetId,
} from "@/components/dashboard/dashboard-types";
import { DeferredDashboardWidget } from "@/components/dashboard/deferred-dashboard-widget";
import { useDashboardWidget } from "@/components/dashboard/use-dashboard-widget";
import { useWidgetOrder } from "@/components/dashboard/use-widget-order";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { useEmployee } from "@/lib/query/use-employee";
import { ViewRefreshProvider } from "./view-refresh-provider";

const route = vi.hoisted(() => ({
	refresh: vi.fn(),
	error: vi.fn(),
	oldRead: vi.fn(),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: route.refresh }),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key) => values?.[key] ?? match),
	}),
}));
vi.mock("sonner", () => ({ toast: { error: route.error, success: vi.fn() } }));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "user-a",
		organizationId: "org-a",
		activeOrganizationId: "org-a",
		employeeId: "viewer-a",
		role: "admin",
		isLoading: false,
		error: null,
	}),
}));
vi.mock("@/components/dashboard/actions", () => ({
	updateWidgetOrder: vi.fn(),
	logWaterIntake: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/wellness/actions", () => ({
	logWaterIntake: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	getEmployee: route.oldRead,
	listEmployeesForSelect: route.oldRead,
	updateEmployee: vi.fn(),
	updateEmployeeInvitationDraft: vi.fn(),
	requestEmployeeWorkBalanceRecalculation: vi.fn(),
}));
vi.mock(
	"@/app/[locale]/(app)/settings/employees/employment-history-client-actions",
	() => ({
		cancelEmployeeEmploymentHistoryAction: vi.fn(),
		changeEmployeeWageAction: vi.fn(),
		confirmEmployeeEmploymentHistoryAction: vi.fn(),
		createEmployeeEmploymentHistoryAction: vi.fn(),
	}),
);

const scope = { userId: "user-a", organizationId: "org-a" };

function ServerWidget({ id, stamp }: { id: ServerWidgetId; stamp: number }) {
	const widget = useDashboardWidget(id, {
		scope,
		result: { success: true, data: null },
		updatedAt: stamp,
	});
	return (
		<p>
			{id}: {widget.loading ? "pending" : "server snapshot"}
		</p>
	);
}

function Layout({ stamp }: { stamp: number }) {
	const layout = useWidgetOrder({
		scope,
		settings: { dashboardWidgetOrder: null },
		availableWidgetIds: [...SERVER_WIDGET_IDS],
		updatedAt: stamp,
	});
	return (
		<output aria-label="Widget order">{layout.widgetOrder.join(",")}</output>
	);
}

function Employee({ stamp, name }: { stamp: number; name: string }) {
	const employee = useEmployee({
		employeeId: "target-a",
		accessTier: "orgAdmin",
		userId: scope.userId,
		organizationId: scope.organizationId,
		initialSnapshot: {
			scope,
			updatedAt: stamp,
			data: {
				id: "target-a",
				kind: "employee",
				organizationId: scope.organizationId,
				user: { name },
			},
		},
	});
	return (
		<>
			<p>{employee.employee?.user.name}</p>
			{employee.readErrors.employmentHistory ? (
				<p role="alert">{employee.readErrors.employmentHistory.message}</p>
			) : null}
			<input aria-label="Employee draft" defaultValue="" />
		</>
	);
}

describe("migrated view refresh owners", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("refreshes server groups once and only activated client regions while retaining employee drafts through a partial failure", async () => {
		const now = Date.now();
		let holdSchedule = false;
		let releaseSchedule!: () => void;
		let failHistory = false;
		const request = vi.fn((url: string) => {
			const path = new URL(url, "http://localhost").pathname;
			const dataset = path.split("/").at(-1);
			const response = (data: unknown) =>
				Response.json({ scope, updatedAt: now + 10, data });
			if (path.startsWith("/api/settings/employees/read/")) {
				if (dataset === "detail")
					throw new Error("The employee detail belongs to the RSC render");
				if (dataset === "schedule" && holdSchedule)
					return new Promise<Response>((resolve) => {
						releaseSchedule = () => resolve(response(null));
					});
				if (dataset === "employment-history" && failHistory)
					return Promise.resolve(
						Response.json({ error: "History unavailable" }, { status: 503 }),
					);
				return Promise.resolve(response(dataset === "schedule" ? null : []));
			}
			if (dataset !== "hydration" && dataset !== "birthday-reminders")
				throw new Error(`Unexpected client read: ${path}`);
			return Promise.resolve(
				Response.json({
					scope,
					updatedAt: now + 10,
					result: { success: true, data: dataset === "hydration" ? null : [] },
				}),
			);
		});
		vi.stubGlobal("fetch", request);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		function Frame({ stamp, name }: { stamp: number; name: string }) {
			return (
				<QueryClientProvider client={client}>
					<SWRConfig value={{ provider: () => new Map() }}>
						<ViewRefreshProvider>
							<HeaderRefreshButton />
							<Layout stamp={stamp} />
							{SERVER_WIDGET_IDS.filter(
								(id) => id !== "hydration" && id !== "birthday-reminders",
							).map((id) => (
								<ServerWidget key={id} id={id} stamp={stamp} />
							))}
							<DeferredDashboardWidget id="hydration" />
							<DeferredDashboardWidget id="birthday-reminders" />
							<Employee stamp={stamp} name={name} />
						</ViewRefreshProvider>
					</SWRConfig>
				</QueryClientProvider>
			);
		}
		const view = render(<Frame stamp={now} name="Pat River" />);
		await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
		expect(route.oldRead).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Load Hydration" }));
		await waitFor(() => expect(request).toHaveBeenCalledTimes(5), {
			timeout: 5000,
		});
		const order = screen.getByLabelText("Widget order").textContent;
		fireEvent.change(screen.getByLabelText("Employee draft"), {
			target: { value: "Unsaved edit" },
		});
		holdSchedule = true;
		failHistory = true;
		request.mockClear();
		const refresh = screen.getByRole("button", { name: "Refresh data" });
		fireEvent.click(refresh);
		await waitFor(() => expect(route.refresh).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(request).toHaveBeenCalledTimes(5));
		expect(refresh.hasAttribute("disabled")).toBe(true);
		await screen.findByText("History unavailable");
		expect(screen.getByText("Pat River")).toBeTruthy();
		view.rerender(<Frame stamp={now + 1} name="Refreshed Pat" />);
		await screen.findByText("Refreshed Pat");
		expect(screen.getByLabelText("Widget order").textContent).toBe(order);
		expect(
			(screen.getByLabelText("Employee draft") as HTMLInputElement).value,
		).toBe("Unsaved edit");
		expect(
			screen.getByRole("button", { name: "Load Upcoming Birthdays" }),
		).toBeTruthy();
		expect(
			request.mock.calls
				.map(([url]) =>
					new URL(url, "http://localhost").pathname.split("/").at(-1),
				)
				.sort(),
		).toEqual([
			"employment-history",
			"hydration",
			"managers",
			"schedule",
			"work-policies",
		]);
		await act(async () => releaseSchedule());
		await waitFor(() => expect(refresh.hasAttribute("disabled")).toBe(false));
		expect(route.error).toHaveBeenCalledTimes(1);
		expect(request).toHaveBeenCalledTimes(5);
	});
});
