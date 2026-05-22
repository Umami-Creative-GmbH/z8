/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import type { DailyWorkHoursSummaries } from "@/lib/calendar/types";
import { DailyRequirementStrip } from "./daily-requirement-strip";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) => {
			if (!params) return fallback;
			return Object.entries(params).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, value),
				fallback,
			);
		},
	}),
}));

describe("DailyRequirementStrip", () => {
	it("shows the negative delta for required days with no recorded work", () => {
		const date = DateTime.fromISO("2026-05-22");
		const summaries: DailyWorkHoursSummaries = new Map([
			[
				"2026-05-22",
				{
					requiredMinutes: 480,
					actualMinutes: 0,
					deltaMinutes: -480,
					status: "missing",
					policyId: "policy-1",
					policyName: "Standard",
				},
			],
		]);

		render(<DailyRequirementStrip dates={[date]} summaries={summaries} />);

		expect(screen.getByText("8:00h")).toBeTruthy();
		expect(screen.getByText("-8:00h")).toBeTruthy();
		expect(
			screen.getByRole("list", { name: "Daily work policy requirement summary" }),
		).toBeTruthy();
		expect(screen.getByRole("listitem")).toBeTruthy();
		expect(
			screen.getByText(
				"Friday, May 22: 8:00h required, 0:00h recorded, -8:00h delta, missing recorded time",
			),
		).toHaveProperty("className", "sr-only");
	});
});
