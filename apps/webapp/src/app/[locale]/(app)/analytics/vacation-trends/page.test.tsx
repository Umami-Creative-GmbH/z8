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
import { SWRConfig } from "swr";
import { beforeEach, expect, it, vi } from "vitest";

const { read, translate } = vi.hoisted(() => ({
	read: vi.fn(),
	translate: (_key: string, fallback: string) => fallback,
}));
vi.mock("../actions", () => ({ getVacationTrendsData: read }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: translate }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/ui/chart", () => ({
	ChartContainer: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ChartTooltip: () => null,
	ChartTooltipContent: () => null,
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

import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import Page from "./page";

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
			<SWRConfig value={{ provider: () => new Map() }}>
				<ViewRefreshProvider>
					<Refresh />
					<Page />
				</ViewRefreshProvider>
			</SWRConfig>
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
	overall: {
		totalDaysAllocated: 30,
		totalDaysTaken: 6,
		totalDaysRemaining: 24,
		utilizationRate: 20,
	},
	byEmployee: [
		{
			employeeId: "e1",
			employeeName: "Alex Example",
			allocated: 30,
			taken: 6,
			remaining: 24,
			utilizationRate: 20,
		},
	],
	byMonth: [{ month: "2025-06", daysTaken: 6, daysRemaining: 24 }],
	patterns: {
		peakMonths: ["2025-06"],
		averageDaysPerRequest: 6,
		clusteringScore: 0,
	},
};
beforeEach(() => {
	read.mockReset();
	useOrganizationSettings.getState().reset();
	hydrate();
});

it("offers retry for failed arrival without presenting invented zero or empty balances", async () => {
	read.mockResolvedValue({ success: false, error: "Unavailable" });
	setup();
	expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
	expect(screen.queryByText("0.0%")).toBeNull();
	expect(
		screen.queryByText("No data available for the selected period"),
	).toBeNull();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	read.mockResolvedValue({ success: true, data });
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByText("Alex Example")).toBeTruthy();
});

it("qualifies missing stored allowance separately from a configured zero", async () => {
	read.mockResolvedValue({
		success: true,
		data: {
			...data,
			byEmployee: [
				{
					...data.byEmployee[0],
					allocated: 0,
					taken: 0,
					remaining: 0,
					utilizationRate: 0,
					allowanceConfigured: false,
				},
				{
					...data.byEmployee[0],
					employeeId: "e2",
					employeeName: "Sam Zero",
					allocated: 0,
					taken: 0,
					remaining: 0,
					utilizationRate: 0,
					allowanceConfigured: true,
				},
			],
		},
	});
	setup();
	const missing = await screen.findByText("Alex Example");
	const missingRow = missing.closest("tr");
	const zeroRow = screen.getByText("Sam Zero").closest("tr");
	if (!missingRow || !zeroRow) throw new Error("Employee rows missing");
	expect(within(missingRow).getByText("Allowance not configured")).toBeTruthy();
	expect(within(zeroRow).queryByText("Allowance not configured")).toBeNull();
	expect(
		screen.getByText(
			"Some employees have no stored allowance. Totals use the existing stored allowances only.",
		),
	).toBeTruthy();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

it("retains comparisons and selected period during failed background refresh and recovers", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Alex Example");
	fireEvent.click(screen.getByRole("button", { name: "Last Year" }));
	await screen.findByText("Alex Example");
	const pending = deferred<{ success: boolean; error: string }>();
	read.mockReturnValueOnce(pending.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Refreshing vacation data");
	expect(screen.getByText("Alex Example")).toBeTruthy();
	await act(async () => pending.resolve({ success: false, error: "Network" }));
	expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
	expect(screen.getByText("Alex Example")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() =>
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull(),
	);
	expect(read.mock.lastCall?.[0].start.toISOString()).toBe(
		"2025-01-01T00:00:00.000Z",
	);
});

it("does not relabel or export the old period while a new range fails", async () => {
	read.mockResolvedValueOnce({ success: true, data });
	setup();
	await screen.findByText("Alex Example");
	read.mockResolvedValue({ success: false, error: "Unavailable" });
	fireEvent.click(screen.getByRole("button", { name: "Last Year" }));
	await screen.findByRole("button", { name: "Retry" });
	expect(screen.queryByText("Alex Example")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
});

it("ignores a late old-organization result", async () => {
	const old = deferred<{ success: boolean; data: typeof data }>();
	read.mockReturnValueOnce(old.promise);
	setup();
	await waitFor(() => expect(read).toHaveBeenCalled());
	read.mockResolvedValue({
		success: true,
		data: {
			...data,
			byEmployee: [{ ...data.byEmployee[0], employeeName: "New Organization" }],
		},
	});
	hydrate("org-2");
	await screen.findByText("New Organization");
	await act(async () => old.resolve({ success: true, data }));
	expect(screen.queryByText("Alex Example")).toBeNull();
	expect(screen.getByText("New Organization")).toBeTruthy();
});

it.each([
	"AuthenticationError",
	"AuthorizationError",
	"NotFoundError",
	"BillingError",
])(
	"clears retained records when server authority is refused: %s",
	async (code) => {
		read.mockResolvedValue({ success: true, data });
		setup();
		await screen.findByText("Alex Example");
		read.mockResolvedValue({ success: false, error: "Refused", code });
		fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
		await screen.findByRole("button", { name: "Retry" });
		expect(screen.queryByText("Alex Example")).toBeNull();
	},
);

it("keeps a successful empty scope distinct from failure", async () => {
	read.mockResolvedValue({
		success: true,
		data: {
			...data,
			overall: {
				totalDaysAllocated: 0,
				totalDaysTaken: 0,
				totalDaysRemaining: 0,
				utilizationRate: 0,
			},
			byEmployee: [],
			byMonth: [],
			patterns: { ...data.patterns, peakMonths: [] },
		},
	});
	setup();
	expect(
		await screen.findByText("No data available for the selected period"),
	).toBeTruthy();
	expect(screen.getByText("0.0%")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("keeps employee comparisons ahead of supporting monthly values, with keyboard-readable taken days", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Alex Example");
	expect(
		screen.getAllByRole("heading", { level: 2 }).map((n) => n.textContent),
	).toEqual([
		"Vacation Utilization",
		"Vacation Balance",
		"Monthly Vacation Usage",
		"Peak Vacation Months",
	]);
	const values = screen.getAllByText("View monthly values");
	expect(values.length).toBe(2);
	fireEvent.click(values[0]);
	expect(screen.getAllByText("2025-06").length).toBeGreaterThan(0);
	expect(within(screen.getByRole("table")).getByText("6")).toBeTruthy();
});
