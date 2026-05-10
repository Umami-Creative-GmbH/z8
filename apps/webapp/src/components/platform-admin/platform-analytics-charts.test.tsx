/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { PlatformAnalyticsData } from "@/lib/platform-analytics/types";

vi.mock("next/dynamic", () => ({
	default: () =>
		function DynamicChartMock({ children }: { children?: React.ReactNode }) {
			return <div data-testid="dynamic-chart">{children}</div>;
		},
}));

vi.mock("@/components/ui/chart", () => ({
	ChartContainer: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="chart-container">{children}</div>
	),
	ChartTooltip: () => null,
	ChartTooltipContent: () => null,
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { PlatformAnalyticsCharts, PlatformAnalyticsPreviewCharts } from "./platform-analytics-charts";

describe("PlatformAnalyticsCharts", () => {
	it("renders KPI cards and chart sections from platform analytics data", () => {
		render(<PlatformAnalyticsCharts data={createAnalyticsData()} />);

		expect(screen.getAllByText("Active users").length).toBeGreaterThan(0);
		expect(screen.getByText("128")).toBeTruthy();
		expect(screen.getAllByText("Signups").length).toBeGreaterThan(0);
		expect(screen.getByText("42")).toBeTruthy();
		expect(screen.getAllByText("Organizations").length).toBeGreaterThan(0);
		expect(screen.getByText("11")).toBeTruthy();
		expect(screen.getAllByText("Sessions").length).toBeGreaterThan(0);
		expect(screen.getByText("918")).toBeTruthy();
		expect(screen.getAllByText("Time records").length).toBeGreaterThan(0);
		expect(screen.getByText("1,204")).toBeTruthy();
		expect(screen.getAllByText("Licensed seats").length).toBeGreaterThan(0);
		expect(screen.getByText("76")).toBeTruthy();
		expect(screen.getAllByText("Estimated MRR").length).toBeGreaterThan(0);
		expect(screen.getByText("€304")).toBeTruthy();

		expect(screen.getByRole("heading", { name: "Growth" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Engagement" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Operations" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Commercial" })).toBeTruthy();
		expect(screen.getByText("Growth summary: 42 signups and 11 organizations."))
			.toBeTruthy();
		expect(screen.getByText("Engagement summary: 128 active users and 918 sessions."))
			.toBeTruthy();
		expect(screen.getByText("Operations summary: 1,204 time records.")).toBeTruthy();
		expect(screen.getByText("Commercial summary: 76 seats and €304 estimated MRR."))
			.toBeTruthy();
	});

	it("hides commercial KPI cards and chart when billing is disabled", () => {
		render(<PlatformAnalyticsCharts data={createAnalyticsData({ billingEnabled: false })} />);

		expect(screen.queryByText("Licensed seats")).toBeNull();
		expect(screen.queryByText("Estimated MRR")).toBeNull();
		expect(screen.queryByRole("heading", { name: "Commercial" })).toBeNull();
	});

	it("renders empty states when the series is empty", () => {
		render(<PlatformAnalyticsCharts data={createAnalyticsData({ series: [] })} />);

		expect(screen.getAllByText("No data for this range")).toHaveLength(4);
		expect(screen.queryAllByTestId("chart-container")).toHaveLength(0);
	});

	it("explains that historical commercial data is estimated when billing estimates are present", () => {
		render(<PlatformAnalyticsCharts data={createAnalyticsData()} />);

		expect(
			screen.getByText(
				"Historical seats and MRR are estimated. Exact reconstruction requires future snapshots or a billing ledger.",
			),
		).toBeTruthy();
	});
});

describe("PlatformAnalyticsPreviewCharts", () => {
	it("renders a compact trends card with a full analytics link", () => {
		render(<PlatformAnalyticsPreviewCharts data={createAnalyticsData()} />);

		expect(screen.getByRole("heading", { name: "Analytics trends" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "View full analytics" }).getAttribute("href")).toBe(
			"/platform-admin/analytics",
		);
		expect(screen.getByRole("heading", { name: "Growth" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Engagement" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();
		expect(screen.queryByRole("heading", { name: "Commercial" })).toBeNull();
		expect(screen.queryByText("No data for this range")).toBeNull();
	});
});

function createAnalyticsData(overrides: Partial<PlatformAnalyticsData> = {}): PlatformAnalyticsData {
	const series = [
		{
			bucketKey: "2026-05-01",
			label: "May 1",
			signups: 18,
			organizations: 4,
			activeUsers: 88,
			sessions: 410,
			timeRecords: 520,
			seats: 40,
			mrr: 160,
			estimatedBilling: true,
		},
		{
			bucketKey: "2026-05-02",
			label: "May 2",
			signups: 24,
			organizations: 7,
			activeUsers: 40,
			sessions: 508,
			timeRecords: 684,
			seats: 36,
			mrr: 144,
			estimatedBilling: true,
		},
	];

	return {
		params: {
			range: "7d",
			bucket: "day",
			startIso: "2026-05-01T00:00:00.000Z",
			endIso: "2026-05-07T23:59:59.999Z",
		},
		billingEnabled: true,
		kpis: {
			activeUsers: 128,
			signups: 42,
			organizations: 11,
			seats: 76,
			sessions: 918,
			timeRecords: 1204,
			mrr: 304,
			estimatedBilling: true,
		},
		series,
		...overrides,
	};
}
