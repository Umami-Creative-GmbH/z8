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
vi.mock("../actions", () => ({ getOvertimeBurnDownData: read }));
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
const row = {
	id: "team-1",
	label: "Operations",
	currentOvertimeHours: 12,
	previousOvertimeHours: 18,
	wowDeltaHours: -6,
	trendDirection: "down",
	weekly: [],
};
const data = {
	summary: {
		currentOvertimeHours: 12,
		wowDeltaHours: -6,
		improvingGroups: 1,
		trendDirection: "down",
	},
	weeklySeries: [],
	byTeam: [row],
	byCostCenter: [{ ...row, id: "cost-1", label: "Delivery" }],
	byManager: [{ ...row, id: "manager-1", label: "Manager One" }],
};
beforeEach(() => {
	read.mockReset();
	exports.length = 0;
	useOrganizationSettings.getState().reset();
	hydrate();
});

it("shows failed arrival as unavailable with retry, without invented zero or empty results", async () => {
	read.mockResolvedValue({ success: false, error: "Read failed" });
	setup();
	expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
	expect(screen.queryByText("0.0h")).toBeNull();
	expect(screen.queryByText("No trend data available yet")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	read.mockResolvedValue({ success: true, data });
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByText("Operations")).toBeTruthy();
});

it("retains the selected range and usable comparisons through pending and failed refresh, then retries", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	fireEvent.click(screen.getByRole("button", { name: "Last Year" }));
	await waitFor(() =>
		expect(read.mock.lastCall?.[0].start.toISOString()).toBe(
			"2025-01-01T00:00:00.000Z",
		),
	);
	await screen.findByText("Operations");
	const pending = Promise.withResolvers();
	read.mockReturnValueOnce(pending.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Refreshing overtime data");
	expect(screen.getByText("Operations")).toBeTruthy();
	await act(async () =>
		pending.resolve({ success: false, error: "Network failure" }),
	);
	await screen.findByRole("button", { name: "Retry" });
	expect(screen.getByText("Operations")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() =>
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull(),
	);
	expect(read.mock.lastCall?.[0].start.toISOString()).toBe(
		"2025-01-01T00:00:00.000Z",
	);
});

it("keeps immediate team filters and their labels during failed reads, without exporting the old scope", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	read.mockResolvedValue({ success: false, error: "Read failed" });
	fireEvent.click(screen.getByRole("combobox", { name: "Team filter" }));
	fireEvent.click(await screen.findByRole("option", { name: "Operations" }));
	await screen.findByRole("button", { name: "Retry" });
	expect(read.mock.lastCall?.[1]).toEqual({ teamId: "team-1" });
	expect(
		screen.getByRole("combobox", { name: "Team filter" }).textContent,
	).toContain("Operations");
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
});

it("switches grouping locally and exports exactly the selected comparison fields", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	fireEvent.click(
		screen.getByRole("combobox", { name: "Breakdown dimension" }),
	);
	fireEvent.click(
		await screen.findByRole("option", { name: "By Cost Center" }),
	);
	expect(await screen.findByText("Delivery")).toBeTruthy();
	expect(
		within(screen.getByRole("table", { name: "Breakdown" }))
			.getAllByRole("columnheader")
			.map((n) => n.textContent),
	).toEqual([
		"Cost Center",
		"Current Overtime",
		"Previous Overtime",
		"Week-over-Week",
		"Trend Direction",
	]);
	fireEvent.click(screen.getByRole("button", { name: "Export" }));
	expect(exports[0]).toMatchObject({
		data: [
			{
				dimension: "Delivery",
				currentOvertime: 12,
				previousOvertime: 18,
				weekOverWeek: -6,
				trendDirection: "Down",
			},
		],
		filename: expect.stringContaining("overtime-burndown-costCenter-"),
	});
	expect(read).toHaveBeenCalledTimes(1);
});

it("retains authorized filter names and other choices when the selected scope returns no records", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	read.mockResolvedValue({
		success: true,
		data: {
			...data,
			byTeam: [],
			byCostCenter: [],
			byManager: [],
			weeklySeries: [],
		},
	});
	fireEvent.click(screen.getByRole("combobox", { name: "Team filter" }));
	fireEvent.click(await screen.findByRole("option", { name: "Operations" }));
	await screen.findByText("No breakdown data available yet");
	expect(
		screen.getByRole("combobox", { name: "Team filter" }).textContent,
	).toContain("Operations");
});

it("distinguishes successful empty trend and breakdown from failed reads", async () => {
	read.mockResolvedValue({
		success: true,
		data: { ...data, byTeam: [], weeklySeries: [] },
	});
	setup();
	expect(await screen.findByText("No trend data available yet")).toBeTruthy();
	expect(screen.getByText("No breakdown data available yet")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("removes cached records on explicit authority loss", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	read.mockResolvedValue({
		success: false,
		code: "AuthorizationError",
		error: "Not authorized",
	});
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByRole("button", { name: "Retry" });
	expect(screen.queryByText("Operations")).toBeNull();
	expect(screen.queryByText("0.0h")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
});

it("ignores stale period and organization replies and clears the old export immediately", async () => {
	read.mockResolvedValue({ success: true, data });
	setup();
	await screen.findByText("Operations");
	const oldPeriod = Promise.withResolvers();
	read.mockReturnValueOnce(oldPeriod.promise);
	fireEvent.click(screen.getByRole("button", { name: "Last Year" }));
	expect(
		screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
	).toBe(true);
	await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
	const newOrg = Promise.withResolvers();
	read.mockReturnValueOnce(newOrg.promise);
	hydrate("org-2");
	await act(async () => oldPeriod.resolve({ success: true, data }));
	expect(screen.queryByText("Operations")).toBeNull();
	await act(async () =>
		newOrg.resolve({
			success: true,
			data: { ...data, byTeam: [{ ...row, label: "New organization" }] },
		}),
	);
	expect(await screen.findByText("New organization")).toBeTruthy();
	expect(screen.queryByText("Operations")).toBeNull();
});
