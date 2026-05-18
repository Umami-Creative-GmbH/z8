/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useWidgetDataMock } = vi.hoisted(() => ({
	useWidgetDataMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "de" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }),
}));

vi.mock("./actions", () => ({ getUpcomingAbsences: vi.fn() }));
vi.mock("./dashboard-widget", () => ({
	DashboardWidget: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./use-widget-data", () => ({ useWidgetData: useWidgetDataMock }));
vi.mock("./widget-card", () => ({
	WidgetCard: ({ children, title }: { children: ReactNode; title: string }) => (
		<section aria-label={title}>{children}</section>
	),
}));

import { UpcomingTimeOffWidget } from "./upcoming-time-off-widget";

describe("UpcomingTimeOffWidget", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 4, 13, 12));
		useWidgetDataMock.mockReturnValue({
			data: [
				{
					id: "absence-1",
					startDate: new Date(Date.UTC(2026, 4, 15)),
					endDate: new Date(Date.UTC(2026, 4, 15)),
					employee: {
						id: "employee-1",
						user: { id: "user-1", name: "Ada Lovelace", image: null },
					},
					category: { name: "Vacation", color: null },
				},
			],
			loading: false,
			refreshing: false,
			refetch: vi.fn(),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("labels a date two calendar days away as two days instead of tomorrow", () => {
		render(<UpcomingTimeOffWidget />);

		expect(screen.getByText("2")).toBeTruthy();
		expect(screen.getByText("days")).toBeTruthy();
		expect(screen.queryByText("Tomorrow")).toBeNull();
	});

	it("formats absence dates with the active UI locale", () => {
		useWidgetDataMock.mockReturnValue({
			data: [
				{
					id: "absence-1",
					startDate: new Date(Date.UTC(2026, 4, 15)),
					endDate: new Date(Date.UTC(2026, 4, 16)),
					employee: {
						id: "employee-1",
						user: { id: "user-1", name: "Ada Lovelace", image: null },
					},
					category: { name: "Vacation", color: null },
				},
			],
			loading: false,
			refreshing: false,
			refetch: vi.fn(),
		});

		render(<UpcomingTimeOffWidget />);

		expect(screen.getByText("15. Mai - 16. Mai")).toBeTruthy();
	});
});
