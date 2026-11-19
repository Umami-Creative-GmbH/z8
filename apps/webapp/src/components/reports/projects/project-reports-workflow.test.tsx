// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectPortfolioData } from "@/lib/reports/project-types";
import { render } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	overview: vi.fn(),
	details: vi.fn(),
	customers: vi.fn(),
	refresh: null as null | (() => Promise<void>),
	scope: { userId: "reader", activeOrganizationId: "A", isLoading: false },
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/reports/projects/actions", () => ({
	getProjectsOverview: mocks.overview,
	getProjectDetailedReport: mocks.details,
	getCustomerBillableReport: mocks.customers,
}));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => mocks.scope,
}));
vi.mock("@/components/providers/view-refresh-provider", () => ({
	useViewRefresh: (handler: () => Promise<void>) => {
		mocks.refresh = handler;
	},
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: import("react").ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("sonner", () => ({
	toast: { success: mocks.success, error: mocks.error },
}));

import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { ProjectReportsContainer } from "./project-reports-container";

function portfolio(hours = 12): ProjectPortfolioData {
	return {
		projects: [],
		totals: {
			totalProjects: 0,
			activeProjects: 0,
			totalHours: hours,
			projectsOverBudget: 0,
			projectsOverdue: 0,
			budgetHealth: {
				projectsAtOrAbove70Budget: 0,
				projectsAtOrAbove90Budget: 0,
				projectsOverBudget: 0,
				projectsForecastAtRisk: 0,
			},
		},
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const tree = (mode: "visible" | "hidden" = "visible") => (
		<QueryClientProvider client={client}>
			<Activity mode={mode}>
				<ProjectReportsContainer />
			</Activity>
		</QueryClientProvider>
	);
	return { ...render(tree()), tree };
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.overview.mockReset();
	mocks.scope = {
		userId: "reader",
		activeOrganizationId: "A",
		isLoading: false,
	};
	useOrganizationSettings.getState().setSettings({ isHydrated: true, timezone: "Europe/Berlin" });
	mocks.overview.mockResolvedValue({ success: true, data: portfolio() });
});

it.each(["organization", "account", "Activity"])(
	"discards a late generation across %s A→B→A and permits a fresh generation",
	async (kind) => {
		const pending = deferred<{ success: true; data: ProjectPortfolioData }>();
		mocks.overview.mockReturnValueOnce(pending.promise);
		const view = mount();
		fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
		await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1));
		if (kind === "Activity") {
			view.rerender(view.tree("hidden"));
			view.rerender(view.tree());
		} else {
			mocks.scope = {
				...mocks.scope,
				...(kind === "organization" ? { activeOrganizationId: "B" } : { userId: "other" }),
			};
			view.rerender(view.tree());
			mocks.scope = {
				userId: "reader",
				activeOrganizationId: "A",
				isLoading: false,
			};
			view.rerender(view.tree());
		}
		await act(async () => pending.resolve({ success: true, data: portfolio(99) }));
		expect(screen.queryByText("99.0 h")).toBeNull();
		expect(mocks.success).not.toHaveBeenCalled();
		mocks.overview.mockResolvedValueOnce({ success: true, data: portfolio() });
		fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
		expect(await screen.findByText("12.0 h")).toBeTruthy();
	},
);

it("preserves the last generated result after a failed generation and a failed background refresh", async () => {
	mount();
	fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
	expect(await screen.findByText("12.0 h")).toBeTruthy();
	mocks.overview.mockResolvedValueOnce({
		success: false,
		error: "Read failed",
	});
	fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
	await screen.findByText("Read failed");
	expect(screen.getByText("12.0 h")).toBeTruthy();
	mocks.overview.mockResolvedValueOnce({
		success: false,
		error: "Refresh failed",
	});
	await act(async () => {
		await expect(mocks.refresh?.()).rejects.toThrow("Could not refresh project reports");
	});
	expect(screen.getByText("12.0 h")).toBeTruthy();
});
afterEach(cleanup);

it("requires generation, retries a failed read with the same calendar scope and prevents pending duplicates", async () => {
	mount();
	expect(mocks.overview).not.toHaveBeenCalled();
	mocks.overview.mockResolvedValueOnce({
		success: false,
		error: "Temporary read failure",
	});
	fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
	await screen.findByText("Temporary read failure");
	const pending = deferred<{ success: true; data: ProjectPortfolioData }>();
	mocks.overview.mockReturnValueOnce(pending.promise);
	const retry = screen.getByRole("button", { name: "Retry" });
	fireEvent.click(retry);
	fireEvent.click(retry);
	expect(mocks.overview).toHaveBeenCalledTimes(2);
	expect(mocks.overview.mock.calls[1]).toEqual(mocks.overview.mock.calls[0]);
	await act(async () => pending.resolve({ success: true, data: portfolio() }));
	expect(await screen.findByText("12.0 h")).toBeTruthy();
});
