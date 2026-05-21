/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PresenceStatusWidget } from "./presence-status-widget";

const mocks = vi.hoisted(() => ({
	getCurrentEmployee: vi.fn(),
	usePresenceStatus: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) => {
			if (!params) return fallback;
			return Object.entries(params).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			);
		},
	}),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	getCurrentEmployee: mocks.getCurrentEmployee,
}));

vi.mock("@/hooks/use-presence-status", () => ({
	usePresenceStatus: mocks.usePresenceStatus,
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

function mockEmployee() {
	mocks.getCurrentEmployee.mockResolvedValue({ id: "emp-1" });
}

describe("PresenceStatusWidget", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders equal home-office and office-required stats", async () => {
		mockEmployee();
		mocks.usePresenceStatus.mockReturnValue({
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

		render(<PresenceStatusWidget />);

		expect(await screen.findByText("Work location")).toBeTruthy();
		expect(screen.getByText("Home office left")).toBeTruthy();
		expect(screen.getByText("Office still required")).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.getByText("2")).toBeTruthy();
	});

	it("renders fixed office day notes", async () => {
		mockEmployee();
		mocks.usePresenceStatus.mockReturnValue({
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

		render(<PresenceStatusWidget />);

		expect(await screen.findByText("Fixed office days: Mon, Wed")).toBeTruthy();
	});

	it("hides when presence is disabled", async () => {
		mockEmployee();
		mocks.usePresenceStatus.mockReturnValue({
			isLoading: false,
			data: { presenceEnabled: false },
		});

		const { container } = render(<PresenceStatusWidget />);

		await waitFor(() => expect(container.innerHTML).toBe(""));
	});

	it("does not force loading when employee lookup returns no employee", async () => {
		mocks.getCurrentEmployee.mockResolvedValue(null);
		mocks.usePresenceStatus.mockReturnValue({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: false,
				message: "Presence policy is unavailable.",
			},
		});

		render(<PresenceStatusWidget />);

		await waitFor(() => expect(screen.queryByText("Loading widget")).toBeNull());
		expect(screen.getByText("Presence policy is unavailable.")).toBeTruthy();
	});

	it("shows an unavailable state for enabled malformed policies", async () => {
		mockEmployee();
		mocks.usePresenceStatus.mockReturnValue({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: false,
				message: "Presence policy has invalid fixed office days.",
			},
		});

		render(<PresenceStatusWidget />);

		expect(await screen.findByText("Presence policy has invalid fixed office days.")).toBeTruthy();
		expect(screen.queryByText("Home office left")).toBeNull();
	});
});
