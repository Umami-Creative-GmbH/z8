/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpcomingShifts } from "@/lib/scheduling/upcoming-shifts";

const { shiftsEnabledMock, useWidgetDataMock } = vi.hoisted(() => ({
	shiftsEnabledMock: vi.fn(),
	useWidgetDataMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useShiftsEnabled: shiftsEnabledMock,
}));

vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({ getMyUpcomingShifts: vi.fn() }));
vi.mock("./dashboard-widget", () => ({
	DashboardWidget: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./use-widget-data", () => ({ useWidgetData: useWidgetDataMock }));
vi.mock("./widget-card", () => ({
	WidgetCard: ({ children, title }: { children: ReactNode; title: string }) => (
		<section aria-label={title}>{children}</section>
	),
}));

import { UpcomingShiftsWidget } from "./upcoming-shifts-widget";

function widgetData(data: UpcomingShifts | null, loading = false) {
	useWidgetDataMock.mockReturnValue({ data, loading, refreshing: false, refetch: vi.fn() });
}

describe("UpcomingShiftsWidget", () => {
	beforeEach(() => {
		shiftsEnabledMock.mockReturnValue(true);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("shows an empty state when nothing is planned", () => {
		widgetData({ today: "2026-10-09", shifts: [] });

		render(<UpcomingShiftsWidget />);

		expect(screen.getByRole("region", { name: "Upcoming Shifts" })).toBeTruthy();
		expect(screen.getByText("No upcoming shifts")).toBeTruthy();
		expect(screen.getByRole("link", { name: /View schedule/ }).getAttribute("href")).toBe(
			"/scheduling",
		);
	});

	it("shows a shift starting just after midnight on the organization's date, not the UTC date", () => {
		// Stored at Berlin midnight (2026-10-08T22:00Z); the server keys it by its Berlin date.
		widgetData({
			today: "2026-10-09",
			shifts: [
				{
					id: "shift-1",
					date: "2026-10-09",
					startTime: "00:30",
					endTime: "06:00",
					notes: null,
					subareaName: "Floor",
					locationName: "Store",
				},
				{
					id: "shift-2",
					date: "2026-10-10",
					startTime: "22:00",
					endTime: "06:00",
					notes: null,
					subareaName: null,
					locationName: null,
				},
			],
		});

		render(<UpcomingShiftsWidget />);

		const first = screen.getByRole("link", { name: /Fri, Oct 9/ });
		expect(first.getAttribute("href")).toBe("/scheduling?date=2026-10-09");
		expect(first.textContent).toContain("Today");
		expect(first.textContent).toContain("00:30 – 06:00");
		expect(first.textContent).toContain("Store · Floor");

		const second = screen.getByRole("link", { name: /Sat, Oct 10/ });
		expect(second.getAttribute("href")).toBe("/scheduling?date=2026-10-10");
		expect(second.textContent).toContain("Tomorrow");
		expect(second.textContent).toContain("ends next day");
	});

	it("renders nothing when shifts are off for the organization", () => {
		shiftsEnabledMock.mockReturnValue(false);
		widgetData({ today: "2026-10-09", shifts: [] });

		const { container } = render(<UpcomingShiftsWidget />);

		expect(container.innerHTML).toBe("");
		expect(useWidgetDataMock).not.toHaveBeenCalled();
	});

	it("renders nothing when the shifts could not be loaded", () => {
		widgetData(null);

		const { container } = render(<UpcomingShiftsWidget />);

		expect(container.innerHTML).toBe("");
	});
});
