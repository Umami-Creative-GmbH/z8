/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "user-a",
		organizationId: "org-a",
		role: "employee",
		isLoading: false,
	}),
}));
vi.mock("./widget-card", () => ({
	WidgetCard: ({ children, title }: { children: ReactNode; title: string }) => (
		<section aria-label={title}>{children}</section>
	),
}));

import type { DashboardWidgetData } from "./dashboard-types";

let delivered: { data: DashboardWidgetData["upcoming-time-off"] | null; loading?: boolean };
function setDelivery(value: typeof delivered) {
	delivered = value;
}
function initialDelivery() {
	return {
		scope: { userId: "user-a", organizationId: "org-a" },
		updatedAt: Date.now(),
		result:
			delivered.data === null
				? { success: false as const, error: "Fixture unavailable" }
				: { success: true as const, data: delivered.data },
	};
}

import { UpcomingTimeOffWidget } from "./upcoming-time-off-widget";

describe("UpcomingTimeOffWidget", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 4, 13, 12));
		setDelivery({
			data: [
				{
					id: "absence-1",
					absenceDays: 1,
					daysUntil: 2,
					startDate: "2026-05-15",
					endDate: "2026-05-15",
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

	it("uses the employee-local server day marker instead of recalculating it in the browser", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<UpcomingTimeOffWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(screen.getByText("2")).toBeTruthy();
		expect(screen.getByText("days")).toBeTruthy();
		expect(screen.queryByText("Tomorrow")).toBeNull();
	});

	it("formats absence dates with the active UI locale", () => {
		setDelivery({
			data: [
				{
					id: "absence-1",
					absenceDays: 1,
					daysUntil: 2,
					startDate: "2026-05-15",
					endDate: "2026-05-16",
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

		render(
			<QueryClientProvider client={new QueryClient()}>
				<UpcomingTimeOffWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(screen.getByText("15. Mai - 16. Mai")).toBeTruthy();
	});
});
