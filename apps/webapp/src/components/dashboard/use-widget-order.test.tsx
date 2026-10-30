/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardLayoutBootstrap } from "./dashboard-types";
import { useWidgetOrder } from "./use-widget-order";

const boundary = vi.hoisted(() => ({
	update: vi.fn(),
	context: {
		userId: "user-a",
		organizationId: "org-a",
		role: "manager",
		isLoading: false,
	},
}));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => boundary.context,
}));
vi.mock("./actions", () => ({ updateWidgetOrder: boundary.update }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const now = Date.now();
function saved(updatedAt = now): DashboardLayoutBootstrap {
	return {
		scope: { userId: "user-a", organizationId: "org-a" },
		updatedAt,
		settings: {
			dashboardWidgetOrder: {
				order: ["quick-stats", "manager-today"],
				hidden: [],
				version: 1,
			},
		},
	};
}
function Layout({ initial, label }: { initial?: DashboardLayoutBootstrap; label: string }) {
	const layout = useWidgetOrder(initial, {
		waitForServerLayout: label === "Header",
	});
	return (
		<>
			<button type="button" onClick={() => layout.resetOrder()}>
				Reset widgets
			</button>
			<button type="button" onClick={() => layout.onVisibilityChange("hydration", true)}>
				Show hydration
			</button>
			<output aria-label={`${label} visible widgets`}>{layout.visibleWidgetOrder.join(",")}</output>
			<p>
				{label}: {layout.visibleWidgetOrder.slice(0, 2).join(",")}
			</p>
			<button type="button" onClick={() => layout.onVisibilityChange("quick-stats", false)}>
				Hide work hours
			</button>
		</>
	);
}
beforeEach(() => {
	vi.clearAllMocks();
	boundary.context.userId = "user-a";
	boundary.context.organizationId = "org-a";
	boundary.context.role = "manager";
});

describe("Dashboard layout bootstrap", () => {
	it("preserves an older explicit layout without showing newly available optional widgets", () => {
		const initial = saved();
		initial.settings.dashboardWidgetOrder = { order: ["quick-stats"], version: 1 };
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Layout label="Grid" initial={initial} />
			</QueryClientProvider>,
		);
		expect(screen.getByLabelText("Grid visible widgets").textContent).toBe("quick-stats");
	});
	it("gives a new employee only eligible defaults and resets to those defaults", async () => {
		const initial = saved();
		initial.settings.dashboardWidgetOrder = null;
		initial.availableWidgetIds = ["quick-stats", "vacation-balance", "pending-approvals"];
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Layout label="Grid" initial={initial} />
			</QueryClientProvider>,
		);
		expect(screen.getByLabelText("Grid visible widgets").textContent).toBe(
			"quick-stats,vacation-balance,pending-approvals",
		);
		boundary.update.mockResolvedValue({ success: true, data: { updatedAt: now + 1 } });
		fireEvent.click(screen.getByRole("button", { name: "Reset widgets" }));
		await waitFor(() => expect(boundary.update).toHaveBeenCalledTimes(1));
		expect(boundary.update.mock.calls[0][0].order).toEqual([
			"quick-stats",
			"vacation-balance",
			"pending-approvals",
		]);
	});
	it("keeps an explicit empty layout empty until a user enables an optional widget", async () => {
		const initial = saved();
		initial.settings.dashboardWidgetOrder = { order: [], hidden: [], version: 1 };
		boundary.update.mockResolvedValue({ success: true, data: { updatedAt: now + 1 } });
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Layout label="Grid" initial={initial} />
			</QueryClientProvider>,
		);
		expect(screen.getByLabelText("Grid visible widgets").textContent).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Show hydration" }));
		await waitFor(() =>
			expect(screen.getByLabelText("Grid visible widgets").textContent).toBe("hydration"),
		);
		expect(boundary.update.mock.calls[0][0].hidden).not.toContain("hydration");
	});
	it("masks newly unavailable widgets without deleting explicit preferences and restores them when eligibility returns", () => {
		const initial = saved();
		initial.settings.dashboardWidgetOrder = {
			order: ["manager-today", "quick-stats", "hydration"],
			hidden: [],
			version: 1,
		};
		const client = new QueryClient();
		const frame = () => (
			<QueryClientProvider client={client}>
				<Layout label="Grid" initial={initial} />
			</QueryClientProvider>
		);
		const view = render(frame());
		expect(screen.getByLabelText("Grid visible widgets").textContent).toBe(
			"manager-today,quick-stats,hydration",
		);
		boundary.context.role = "employee";
		initial.availableWidgetIds = ["quick-stats"];
		initial.updatedAt = now + 1;
		view.rerender(frame());
		expect(screen.getByLabelText("Grid visible widgets").textContent).toBe("quick-stats");
		boundary.context.role = "manager";
		initial.availableWidgetIds = ["manager-today", "quick-stats", "hydration"];
		initial.updatedAt = now + 2;
		view.rerender(frame());
		expect(screen.getByLabelText("Grid visible widgets").textContent).toBe(
			"manager-today,quick-stats,hydration",
		);
		expect(boundary.update).not.toHaveBeenCalled();
	});
	it("shares reduced feature eligibility with the header while a layout command is pending", async () => {
		let finish: (value: unknown) => void = () => {};
		boundary.update.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const client = new QueryClient();
		const initial = saved();
		initial.settings.dashboardWidgetOrder = {
			order: ["quick-stats", "hydration", "manager-today"],
			hidden: [],
			version: 1,
		};
		const frame = (bootstrap: DashboardLayoutBootstrap) => (
			<QueryClientProvider client={client}>
				<Layout label="Header" />
				<Layout label="Grid" initial={bootstrap} />
			</QueryClientProvider>
		);
		const view = render(frame(initial));
		fireEvent.click(screen.getAllByRole("button", { name: "Hide work hours" })[0]);
		await waitFor(() => expect(boundary.update).toHaveBeenCalledTimes(1));
		view.rerender(
			frame({
				...initial,
				updatedAt: now + 1,
				availableWidgetIds: ["quick-stats", "manager-today"],
			}),
		);
		await waitFor(() =>
			expect(screen.getByLabelText("Header visible widgets").textContent).toBe("manager-today"),
		);
		expect(screen.getByLabelText("Grid visible widgets").textContent).toBe("manager-today");
		await act(async () => finish({ success: true, data: { success: true, updatedAt: now + 2 } }));
		expect(screen.getByLabelText("Grid visible widgets").textContent).toBe("manager-today");
	});
	it("shares server settings with the header caller rendered before the grid without an initial GET", async () => {
		const request = vi.fn();
		vi.stubGlobal("fetch", request);
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<Layout label="Header" />
				<Layout label="Grid" initial={saved()} />
			</QueryClientProvider>,
		);
		await screen.findByText("Header: quick-stats,manager-today");
		expect(screen.getByText("Grid: quick-stats,manager-today")).toBeTruthy();
		expect(request).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
	it("waits for the server grid when the header hydrates before its layout chunk arrives", async () => {
		const request = vi.fn();
		vi.stubGlobal("fetch", request);
		const client = new QueryClient();
		const view = render(
			<QueryClientProvider client={client}>
				<Layout label="Header" />
			</QueryClientProvider>,
		);
		await act(async () => {});
		expect(request).not.toHaveBeenCalled();
		view.rerender(
			<QueryClientProvider client={client}>
				<Layout label="Header" />
				<Layout label="Grid" initial={saved()} />
			</QueryClientProvider>,
		);
		await screen.findByText("Header: quick-stats,manager-today");
		expect(request).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it("keeps a pending customization through a server merge and captures its original authorization scope", async () => {
		let finish!: (value: unknown) => void;
		boundary.update.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const client = new QueryClient();
		const frame = (initial: DashboardLayoutBootstrap) => (
			<QueryClientProvider client={client}>
				<Layout label="Grid" initial={initial} />
			</QueryClientProvider>
		);
		const view = render(frame(saved()));
		fireEvent.click(screen.getByRole("button", { name: "Hide work hours" }));
		await waitFor(() => expect(boundary.update).toHaveBeenCalledTimes(1));
		view.rerender(frame(saved(now + 1)));
		expect(screen.getByText(/Grid: manager-today/)).toBeTruthy();
		expect(boundary.update.mock.calls[0][1]).toEqual({
			userId: "user-a",
			organizationId: "org-a",
		});
		await act(async () => {
			finish({ success: true, data: { success: true, updatedAt: now + 2 } });
		});
		expect(screen.getByText(/Grid: manager-today/)).toBeTruthy();
		const newest = saved(now + 3);
		view.rerender(frame(newest));
		await screen.findByText("Grid: quick-stats,manager-today");
	});
});
