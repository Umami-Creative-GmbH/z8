/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("./actions", () => ({ getWhosOutToday: vi.fn() }));
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

let delivered: { data: DashboardWidgetData["whos-out-today"] | null; loading?: boolean };
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

import { WhosOutTodayWidget } from "./whos-out-today-widget";

describe("WhosOutTodayWidget", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("does not label a Friday absence as returning tomorrow when the next workday is Monday", () => {
		setDelivery({
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
						returnDate: "2026-05-18",
					},
				],
				returningTomorrow: [],
				totalOut: 1,
			},
			loading: false,
			refreshing: false,
			refetch: vi.fn(),
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<WhosOutTodayWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(screen.queryByText("Returns tomorrow")).toBeNull();
		expect(screen.queryByText("Returning Tomorrow")).toBeNull();
		expect(screen.getByText("Until 18. Mai")).toBeTruthy();
	});

	it("formats return dates with the active UI locale", () => {
		setDelivery({
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
						returnDate: "2026-05-18",
					},
				],
				returningTomorrow: [],
				totalOut: 1,
			},
			loading: false,
			refreshing: false,
			refetch: vi.fn(),
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<WhosOutTodayWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(screen.getByText("Until 18. Mai")).toBeTruthy();
	});
});
