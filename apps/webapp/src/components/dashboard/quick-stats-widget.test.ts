/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replace(`{${key}}`, value),
				fallback,
			),
	}),
}));

vi.mock("./actions", () => ({ getQuickStats: vi.fn() }));
vi.mock("./dashboard-widget", () => ({
	DashboardWidget: ({ children }: { children: unknown }) => children,
}));
vi.mock("./use-widget-data", () => ({ useWidgetData: vi.fn() }));
vi.mock("./widget-card", () => ({ WidgetCard: ({ children }: { children: unknown }) => children }));

import { getQuickStatsStatus, QuickStatsWidget } from "./quick-stats-widget";
import { useWidgetData } from "./use-widget-data";

describe("getQuickStatsStatus", () => {
	it("does not mark early-period paced progress as behind", () => {
		expect(getQuickStatsStatus({ actual: 4, expectedToDate: 4 })).toBe("on-track");
	});

	it("marks genuine expected-to-date shortfall as behind", () => {
		expect(getQuickStatsStatus({ actual: 2.5, expectedToDate: 4 })).toBe("behind");
	});

	it("uses good pace between behind and on-track thresholds", () => {
		expect(getQuickStatsStatus({ actual: 3.2, expectedToDate: 4 })).toBe("good-pace");
	});

	it("avoids behind when expected-to-date is zero", () => {
		expect(getQuickStatsStatus({ actual: 0, expectedToDate: 0 })).toBe("good-pace");
	});
});

describe("QuickStatsWidget", () => {
	it("uses expected-to-date for status while showing full-period progress", () => {
		vi.mocked(useWidgetData).mockReturnValue({
			data: {
				thisWeek: { actual: 4, expected: 40, expectedToDate: 4 },
				thisMonth: { actual: 10, expected: 160, expectedToDate: 20 },
			},
			loading: false,
			refreshing: false,
			refetch: vi.fn(),
		});

		render(createElement(QuickStatsWidget));

		expect(screen.getByText("On track")).toBeTruthy();
		expect(screen.getByText("4.0h of 40.0h (10%)")).toBeTruthy();
	});
});
