/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVacationBalanceResult } from "./actions";
import { VacationBalanceWidget } from "./vacation-balance-widget";

vi.mock("./actions", () => ({ getVacationBalanceResult: vi.fn() }));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ organizationId: "org-1" }),
}));
vi.mock("./dashboard-widget", () => ({
	DashboardWidget: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			fallback: string,
			params?: Record<string, string | number>,
		) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
beforeEach(() => {
	vi.spyOn(Date.prototype, "getFullYear").mockReturnValue(2026);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("VacationBalanceWidget organization year", () => {
	it("labels a loaded balance with its server-selected year instead of the viewer year", async () => {
		vi.mocked(getVacationBalanceResult).mockResolvedValue({
			success: true,
			data: {
				year: 2027,
				configuration: { status: "resolved" },
				balance: {
					totalDays: 30,
					usedDays: 5,
					pendingDays: 0,
					remainingDays: 25,
					carryoverDays: 0,
					carryoverExpiryDate: null,
					carryoverExpiryDaysRemaining: null,
					hasCarryover: false,
				},
			},
		});
		render(<VacationBalanceWidget />);
		expect(await screen.findByText("2027 vacation days")).toBeTruthy();
		expect(screen.queryByText("2026 vacation days")).toBeNull();
		expect(screen.getAllByText("25.0").length).toBeGreaterThan(0);
	});
	it.each(["missing", "conflict"] as const)(
		"retains the selected year alongside %s policy status",
		async (status) => {
			vi.mocked(getVacationBalanceResult).mockResolvedValue({
				success: true,
				data: {
					year: 2027,
					balance: null,
					configuration: {
						status,
						periods: [{ startDate: "2027-01-01", endDate: "2027-12-31" }],
					},
				},
			});
			render(<VacationBalanceWidget />);
			expect(await screen.findByText("2027 vacation days")).toBeTruthy();
			expect(
				screen.getByText(
					status === "missing"
						? "Missing vacation policy"
						: "Conflicting vacation policies",
				),
			).toBeTruthy();
		},
	);
	it("waits for the selected year while loading", () => {
		vi.mocked(getVacationBalanceResult).mockImplementation(
			() => new Promise(() => {}),
		);
		render(<VacationBalanceWidget />);
		expect(screen.queryByText(/vacation days$/)).toBeNull();
	});
});
