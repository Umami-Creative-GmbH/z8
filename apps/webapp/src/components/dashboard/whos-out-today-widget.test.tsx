/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useWidgetDataMock } = vi.hoisted(() => ({
	useWidgetDataMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
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

vi.mock("./actions", () => ({ getWhosOutToday: vi.fn() }));
vi.mock("./dashboard-widget", () => ({
	DashboardWidget: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./use-widget-data", () => ({ useWidgetData: useWidgetDataMock }));
vi.mock("./widget-card", () => ({
	WidgetCard: ({ children, title }: { children: ReactNode; title: string }) => (
		<section aria-label={title}>{children}</section>
	),
}));

import { WhosOutTodayWidget } from "./whos-out-today-widget";

describe("WhosOutTodayWidget", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("does not label a Friday absence as returning tomorrow when the next workday is Monday", () => {
		useWidgetDataMock.mockReturnValue({
			data: {
				outToday: [
					{
						id: "employee-1",
						userId: "user-1",
						name: "Ada Lovelace",
						image: null,
						category: "Vacation",
						categoryColor: null,
						endsToday: true,
						returnsTomorrow: false,
						returnDate: "May 18",
					},
				],
				returningTomorrow: [],
				totalOut: 1,
			},
			loading: false,
			refreshing: false,
			refetch: vi.fn(),
		});

		render(<WhosOutTodayWidget />);

		expect(screen.queryByText("Returns tomorrow")).toBeNull();
		expect(screen.queryByText("Returning Tomorrow")).toBeNull();
		expect(screen.getByText("Until May 18")).toBeTruthy();
	});
});
