/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RateHistoryCard } from "./rate-history-card";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number | null>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
				fallback,
			),
	}),
}));

describe("RateHistoryCard", () => {
	it("keeps the timeline dot from overlapping the rate text", () => {
		render(
			<RateHistoryCard
				rateHistory={[
					{
						id: "rate-current",
						employeeId: "employee-1",
						organizationId: "org-1",
						hourlyRate: "60.00",
						currency: "EUR",
						effectiveFrom: new Date("2026-06-09T00:00:00.000Z"),
						effectiveTo: null,
						reason: "Rate updated",
						createdBy: "user-1",
						createdAt: new Date("2026-06-09T00:00:00.000Z"),
					},
				]}
				isAdmin={false}
				onAddRate={vi.fn()}
			/>,
		);

		const rateText = screen.getByText((content) => content.includes("60"));

		expect(rateText.closest(".flex-1")?.className).toContain("ml-4");
	});
});
