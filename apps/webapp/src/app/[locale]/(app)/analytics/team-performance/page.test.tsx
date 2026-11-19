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
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const { read, translate } = vi.hoisted(() => ({
	read: vi.fn(),
	translate: (_key: string, fallback: string) => fallback,
}));
vi.mock("../actions", () => ({ getTeamPerformanceData: read }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: translate }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("next/dynamic", () => ({
	default:
		() =>
		({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/chart", () => ({
	ChartContainer: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ChartTooltip: () => null,
	ChartTooltipContent: () => null,
}));
vi.mock("@/components/analytics/date-range-picker", () => ({
	AnalyticsDateRangePicker: ({
		onChange,
	}: {
		onChange: (range: { start: Date; end: Date }) => void;
	}) => (
		<button
			type="button"
			onClick={() =>
				onChange({ start: new Date("2025-01-01"), end: new Date("2025-12-31") })
			}
		>
			Last Year
		</button>
	),
}));
vi.mock("@/components/analytics/export-button", () => ({
	ExportButton: ({ data, disabled }: { data: unknown; disabled: boolean }) => (
		<button
			type="button"
			disabled={disabled}
			onClick={() => exports.push(data)}
		>
			Export
		</button>
	),
}));

import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import Page from "./page";

const exports: unknown[] = [];
function Refresh() {
	const { refresh } = useViewRefreshAction();
	return (
		<button type="button" onClick={refresh}>
			Refresh data
		</button>
	);
}
function setup() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<ViewRefreshProvider>
				<Refresh />
				<Page />
			</ViewRefreshProvider>
		</QueryClientProvider>,
	);
}
function hydrate(organizationId = "org-1") {
	act(() =>
		useOrganizationSettings.getState().hydrate({
			organizationId,
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			timezone: "Europe/Berlin",
			deletedAt: null,
		}),
	);
}
const data = {
	teams: [
		{
			teamId: "team-1",
			teamName: "Operations",
			totalHours: 81.25,
			avgHoursPerEmployee: 40.625,
			employeeCount: 2,
			employees: [
				{
					employeeId: "e1",
					employeeName: "Alex",
					totalHours: 45.25,
					expectedHours: 40,
					variance: 5.25,
					percentageOfExpected: 113.125,
				},
				{
					employeeId: "e2",
					employeeName: "Sam",
					totalHours: 36,
					expectedHours: 40,
					variance: -4,
					percentageOfExpected: 90,
				},
			],
		},
	],
	organizationTotal: 81.25,
};
beforeEach(() => {
	read.mockReset();
	exports.length = 0;
	useOrganizationSettings.getState().reset();
	hydrate();
});

it("distinguishes failed arrival from empty period and retries the same selected range", async () => {
	read.mockResolvedValue({ success: false, error: "Read failed" });
	setup();
	expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
	expect(
		screen.queryByText("No data available for the selected period"),
	).toBeNull();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	read.mockResolvedValue({ success: true, data });
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByText("Operations")).toBeTruthy();
});

it("retains usable rows during failed background refresh, blocks export, and reports failure to shared refresh", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	const pending = Promise.withResolvers();
	read.mockReturnValueOnce(pending.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Refreshing team performance data");
	expect(screen.getByText("Operations")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	await act(async () =>
		pending.resolve({ success: false, error: "Temporary outage" }),
	);
	await screen.findByText(/Showing previously loaded data/);
	expect(screen.getByText("Operations")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	const retry = Promise.withResolvers();
	read.mockReturnValueOnce(retry.promise);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(screen.getByText("Operations")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	await act(async () =>
		retry.resolve({ success: false, error: "Still unavailable" }),
	);
	expect(screen.getByText("Operations")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled"),
	).toBe(false);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
		).toBe(false),
	);
});

it("never pairs another period's rows with the current export, and ignores late results", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	const old = Promise.withResolvers();
	read.mockReturnValueOnce(old.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Refreshing team performance data");
	read.mockResolvedValue({ success: false, error: "Read failed" });
	fireEvent.click(screen.getByRole("button", { name: "Last Year" }));
	await screen.findByRole("button", { name: "Retry" });
	expect(screen.queryByText("Operations")).toBeNull();
	await act(async () => old.resolve({ success: true, data }));
	expect(screen.queryByText("Operations")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	read.mockResolvedValue({ success: true, data });
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText("Operations");
	fireEvent.click(screen.getByRole("button", { name: "Export" }));
	expect(exports[0]).toMatchObject({
		data: data.teams,
		filename: "team-performance-2025-01-01",
	});
});

it.each([
	"AuthenticationError",
	"AuthorizationError",
	"NotFoundError",
	"BillingError",
])("removes admitted rows after %s even during refresh", async (code) => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	read.mockResolvedValue({ success: false, code, error: "Unavailable" });
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByRole("button", { name: "Retry" });
	expect(screen.queryByText("Operations")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
});

it("resets organization-scoped results while an old read is in flight", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	const old = Promise.withResolvers();
	read.mockReturnValueOnce(old.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Refreshing team performance data");
	read.mockResolvedValue({ success: true, data: { ...data, teams: [] } });
	hydrate("org-2");
	await screen.findByText("No data available for the selected period");
	await act(async () => old.resolve({ success: true, data }));
	expect(screen.queryByText("Operations")).toBeNull();
});

it("retains all original comparison fields and status meaning", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	const row = (await screen.findByText("Operations")).closest("tr");
	if (!row) throw new Error("Team row missing");
	expect(within(row).getByText("81.3h")).toBeTruthy();
	expect(within(row).getByText("40.6h")).toBeTruthy();
	expect(within(row).getByText("2")).toBeTruthy();
	expect(within(row).getByText("On Track")).toBeTruthy();
});
