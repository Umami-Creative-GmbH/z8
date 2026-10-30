/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PresenceStatusWidget } from "./presence-status-widget";

let delivered: { data: Record<string, unknown>; isLoading: boolean };
function setDelivery(value: typeof delivered) {
	delivered = value;
}
function initialDelivery() {
	return {
		scope: { userId: "user-1", organizationId: "org-1" },
		updatedAt: Date.now(),
		result: { success: true as const, data: delivered.data },
	};
}
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) => {
			const translatedWeekdays: Record<string, string> = {
				"common.weekdays.mon": "Mo",
				"common.weekdays.tue": "Di",
				"common.weekdays.wed": "Mi",
				"common.weekdays.thu": "Do",
			};
			if (!params && translatedWeekdays[_key]) return translatedWeekdays[_key];
			if (!params) return fallback;
			return Object.entries(params).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			);
		},
	}),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "user-1",
		organizationId: "org-1",
		role: "employee",
		isLoading: false,
	}),
}));

vi.mock("./dashboard-widget", () => ({
	DashboardWidget: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

vi.mock("./widget-card", () => ({
	WidgetCard: ({
		children,
		description,
		loading,
		title,
	}: {
		children: ReactNode;
		description: string;
		loading?: boolean;
		title: string;
	}) => (
		<section aria-label={title}>
			<h2>{title}</h2>
			<p>{description}</p>
			{loading ? <p>Loading widget</p> : children}
		</section>
	),
}));

describe("PresenceStatusWidget", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders equal home-office and office-required stats", async () => {
		setDelivery({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: true,
				period: "weekly",
				periodStart: "2026-05-04T00:00:00.000Z",
				periodEnd: "2026-05-10T23:59:59.999Z",
				mode: "minimum_count",
				homeOfficeDaysLeft: 1,
				officeDaysRequiredLeft: 2,
				officeDaysCompleted: 1,
				homeOfficeDaysUsed: 1,
				workingDaysRemaining: 3,
				requiredOfficeDays: 3,
				fixedOfficeDays: [],
				message: null,
			},
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<PresenceStatusWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(await screen.findByText("Work location")).toBeTruthy();
		expect(screen.getByText("Home office left")).toBeTruthy();
		expect(screen.getByText("Office still required")).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.getByText("2")).toBeTruthy();
	});

	it("renders localized fixed office day notes", async () => {
		setDelivery({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: true,
				period: "weekly",
				periodStart: "2026-05-04T00:00:00.000Z",
				periodEnd: "2026-05-10T23:59:59.999Z",
				mode: "fixed_days",
				homeOfficeDaysLeft: 3,
				officeDaysRequiredLeft: 1,
				officeDaysCompleted: 1,
				homeOfficeDaysUsed: 0,
				workingDaysRemaining: 4,
				requiredOfficeDays: 2,
				fixedOfficeDays: ["monday", "wednesday"],
				message: null,
			},
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<PresenceStatusWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(await screen.findByText("Fixed office days: Mo, Mi")).toBeTruthy();
	});

	it("renders fixed office day notes with common localized weekday labels", async () => {
		setDelivery({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: true,
				period: "weekly",
				periodStart: "2026-05-04T00:00:00.000Z",
				periodEnd: "2026-05-10T23:59:59.999Z",
				mode: "fixed_days",
				homeOfficeDaysLeft: 3,
				officeDaysRequiredLeft: 1,
				officeDaysCompleted: 1,
				homeOfficeDaysUsed: 0,
				workingDaysRemaining: 4,
				requiredOfficeDays: 2,
				fixedOfficeDays: ["tuesday", "thursday"],
				message: null,
			},
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<PresenceStatusWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(await screen.findByText("Fixed office days: Di, Do")).toBeTruthy();
	});

	it("hides when presence is disabled", async () => {
		setDelivery({
			isLoading: false,
			data: { presenceEnabled: false },
		});

		const { container } = render(
			<QueryClientProvider client={new QueryClient()}>
				<PresenceStatusWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		await waitFor(() => expect(container.innerHTML).toBe(""));
	});

	it("renders unavailable data without a separate employee lookup", async () => {
		setDelivery({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: false,
				message: "Presence policy is unavailable.",
			},
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<PresenceStatusWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		await waitFor(() => expect(screen.queryByText("Loading widget")).toBeNull());
		expect(screen.getByText("Presence policy is unavailable.")).toBeTruthy();
	});

	it("shows an unavailable state for enabled malformed policies", async () => {
		setDelivery({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: false,
				message: "Presence policy has invalid fixed office days.",
			},
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<PresenceStatusWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(await screen.findByText("Presence policy has invalid fixed office days.")).toBeTruthy();
		expect(screen.queryByText("Home office left")).toBeNull();
	});
});
