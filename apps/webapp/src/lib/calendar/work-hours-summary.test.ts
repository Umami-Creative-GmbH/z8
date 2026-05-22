import { describe, expect, it } from "vitest";
import type { CalendarEvent, DailyWorkRequirements } from "./types";
import { buildDailyWorkHoursSummaries, formatSignedMinutes, formatTimeHours } from "./work-hours-summary";

function workPeriod(date: string, durationMinutes: number): CalendarEvent {
	return {
		id: `${date}-${durationMinutes}`,
		type: "work_period",
		date: new Date(`${date}T08:00:00.000Z`),
		endDate: new Date(`${date}T16:00:00.000Z`),
		title: "Work",
		color: "#10b981",
		metadata: { durationMinutes, employeeName: "Ada" },
	};
}

describe("buildDailyWorkHoursSummaries", () => {
	it("sums work periods and marks over when actual is above required", () => {
		const requirements: DailyWorkRequirements = {
			"2026-05-04": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
		};

		const summaries = buildDailyWorkHoursSummaries({
			events: [workPeriod("2026-05-04", 240), workPeriod("2026-05-04", 247)],
			dailyRequirements: requirements,
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 487,
			deltaMinutes: 7,
			status: "over",
		});
	});

	it("marks under when actual is below required", () => {
		const summaries = buildDailyWorkHoursSummaries({
			events: [workPeriod("2026-05-04", 449)],
			dailyRequirements: {
				"2026-05-04": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
			},
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 449,
			deltaMinutes: -31,
			status: "under",
		});
	});

	it("marks missing when required time exists but no work was recorded", () => {
		const summaries = buildDailyWorkHoursSummaries({
			events: [],
			dailyRequirements: {
				"2026-05-04": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
			},
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 0,
			deltaMinutes: -480,
			status: "missing",
		});
	});

	it("does not create summaries without a policy requirement", () => {
		const summaries = buildDailyWorkHoursSummaries({
			events: [workPeriod("2026-05-04", 480)],
			dailyRequirements: {},
		});

		expect(summaries.size).toBe(0);
	});
});

describe("format helpers", () => {
	it("formats required hours and signed deltas", () => {
		expect(formatTimeHours(480)).toBe("8:00h");
		expect(formatTimeHours(449)).toBe("7:29h");
		expect(formatSignedMinutes(7)).toBe("+0:07h");
		expect(formatSignedMinutes(-31)).toBe("-0:31h");
	});
});
