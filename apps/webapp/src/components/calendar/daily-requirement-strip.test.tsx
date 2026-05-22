/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { DailyWorkHoursSummaries } from "@/lib/calendar/types";
import { DailyRequirementStrip } from "./daily-requirement-strip";

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
	});
});
