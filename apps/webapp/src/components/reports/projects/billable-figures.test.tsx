/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BillableFigures } from "@/lib/reports/project-types";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));

import { BillableFiguresCard } from "./billable-figures";

const base = {
	currency: "EUR",
	billableMinutes: 120,
	billableHours: 2,
	nonBillableMinutes: 60,
	nonBillableHours: 1,
	unpricedWorkCount: 0,
	unpricedHours: 0,
	pendingReviewCount: 0,
	revenue: "200.00",
};
const context = { currency: "EUR", ratesResolvedAt: "2026-05-02T08:00:00Z" };

describe("BillableFiguresCard", () => {
	it("shows a project manager hours and revenue, and no cost or margin", () => {
		const figures: BillableFigures = { access: "revenue", ...base };
		render(<BillableFiguresCard figures={figures} context={context} />);

		expect(screen.getByText("Revenue")).toBeTruthy();
		expect(screen.getByText("€200.00")).toBeTruthy();
		expect(screen.queryByText("Cost")).toBeNull();
		expect(screen.queryByText("Margin")).toBeNull();
	});

	it("shows an unknown margin as cost unknown, never as 100%", () => {
		const figures: BillableFigures = {
			access: "full",
			...base,
			cost: null,
			margin: null,
			marginPercent: null,
			costUnknownWorkCount: 1,
		};
		const { container } = render(<BillableFiguresCard figures={figures} context={context} />);

		expect(screen.getAllByText("Cost unknown")).toHaveLength(2);
		expect(container.textContent).not.toContain("100");
	});
});
