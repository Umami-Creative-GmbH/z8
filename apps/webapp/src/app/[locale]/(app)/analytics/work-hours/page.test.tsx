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
vi.mock("../actions", () => ({ getWorkHoursAnalyticsData: read }));
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
	byEmployee: [
		{
			employeeId: "e1",
			employeeName: "Alex",
			totalHours: 81.25,
			overtimeHours: 5.25,
			undertimeHours: 2.75,
			avgHoursPerWeek: 35.4,
		},
	],
	distribution: [
		{
			date: "2025-01-02",
			hours: 8.5,
			expectedHours: 8,
			isOvertime: true,
			isUndertime: false,
		},
	],
	totalHours: 81.25,
	averageHoursPerDay: 8.125,
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
	expect(await screen.findByText("Alex")).toBeTruthy();
});

it("retains usable rows during failed background refresh, blocks export, and reports failure to shared refresh", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Alex");
	const pending = Promise.withResolvers();
	read.mockReturnValueOnce(pending.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Refreshing work hours analytics data");
	expect(screen.getByText("Alex")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	await act(async () =>
		pending.resolve({ success: false, error: "Temporary outage" }),
	);
	await screen.findByText(/Showing previously loaded data/);
	expect(screen.getByText("Alex")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	const retry = Promise.withResolvers();
	read.mockReturnValueOnce(retry.promise);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText("Refreshing work hours analytics data");
	expect(screen.getByText("Alex")).toBeTruthy();
	await act(async () => retry.resolve({ success: true, data }));
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
		).toBe(false),
	);
});

it("never pairs another period's rows with the current export, and ignores late results", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Alex");
	const old = Promise.withResolvers();
	read.mockReturnValueOnce(old.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Refreshing work hours analytics data");
	read.mockResolvedValue({ success: false, error: "Read failed" });
	fireEvent.click(screen.getByRole("button", { name: "Last Year" }));
	await screen.findByRole("button", { name: "Retry" });
	expect(screen.queryByText("Alex")).toBeNull();
	await act(async () => old.resolve({ success: true, data }));
	expect(screen.queryByText("Alex")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	read.mockResolvedValue({ success: true, data });
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText("Alex");
	fireEvent.click(screen.getByRole("button", { name: "Export" }));
	expect(exports[0]).toMatchObject({
		data: data.byEmployee,
		filename: "work-hours-2025-01-01",
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
	await screen.findByText("Alex");
	read.mockResolvedValue({ success: false, code, error: "Unavailable" });
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByRole("button", { name: "Retry" });
	expect(screen.queryByText("Alex")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
});

it("resets organization-scoped results while an old read is in flight", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Alex");
	const old = Promise.withResolvers();
	read.mockReturnValueOnce(old.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Refreshing work hours analytics data");
	read.mockResolvedValue({ success: true, data: { ...data, byEmployee: [] } });
	hydrate("org-2");
	await screen.findByText("No data available for the selected period");
	await act(async () => old.resolve({ success: true, data }));
	expect(screen.queryByText("Alex")).toBeNull();
});

it("retains all original comparison fields and status meaning", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	const row = (await screen.findByText("Alex")).closest("tr");
	if (!row) throw new Error("Team row missing");
	expect(within(row).getByText("81.3h")).toBeTruthy();
	expect(within(row).getByText("86.5h")).toBeTruthy();
	expect(within(row).getByText("+5.3h")).toBeTruthy();
	expect(within(row).getByText("35h/wk")).toBeTruthy();
});

it("exposes authoritative daily values and flags without inventing numeric variance", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Alex");
	expect(screen.getByText("View daily hours")).toBeTruthy();
	const table = screen.getByRole("table", { name: "Daily Work Hours" });
	expect(within(table).getByText("8.5h")).toBeTruthy();
	expect(within(table).getByText("8h")).toBeTruthy();
	expect(
		screen.getByText(
			/Daily overtime and undertime hour values are unavailable/,
		),
	).toBeTruthy();
});

it("keeps successful chart empties independent of employee records and unavailable", async () => {
	read.mockResolvedValue({
		success: true,
		data: { ...data, distribution: [] },
	});
	setup();
	await screen.findByText("Alex");
	expect(screen.getByText("No daily hours data available")).toBeTruthy();
	expect(screen.getByText("No trend data available")).toBeTruthy();
	expect(screen.queryByText("No distribution data available")).toBeNull();
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});
