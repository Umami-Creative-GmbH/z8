import { describe, expect, it } from "vitest";
import type { DailyWorkRequirements } from "@/lib/calendar/types";
import {
	type ApprenticeReleaseRecord,
	apprenticeReleaseDays,
	applyApprenticeReleaseCredits,
} from "./release-credits";

function release(
	partial: Partial<ApprenticeReleaseRecord> &
		Pick<ApprenticeReleaseRecord, "releaseKind" | "startsOn">,
): ApprenticeReleaseRecord {
	return {
		id: `${partial.releaseKind}-${partial.startsOn}`,
		endsOn: partial.startsOn,
		lessonCount: null,
		schoolMinutes: null,
		examStartTime: null,
		...partial,
	};
}

const requirementsOf = (days: Record<string, number>): DailyWorkRequirements =>
	Object.fromEntries(
		Object.entries(days).map(([date, requiredMinutes]) => [
			date,
			{ requiredMinutes, policyId: "p", policyName: "Policy" },
		]),
	);

describe("apprenticeReleaseDays", () => {
	it("credits the first school day of a week with more than five lessons as a full day", () => {
		const days = apprenticeReleaseDays([
			release({ releaseKind: "vocational_school_day", startsOn: "2026-03-03", lessonCount: 6 }),
			release({ releaseKind: "vocational_school_day", startsOn: "2026-03-05", lessonCount: 6 }),
		]);
		expect(days).toEqual([
			expect.objectContaining({ date: "2026-03-03", credit: "full_day", minutes: null }),
			// The second long school day of the week is credited with its lessons (6 × 45 min).
			expect.objectContaining({ date: "2026-03-05", credit: "school_minutes", minutes: 270 }),
		]);
	});

	it("credits a school day of up to five lessons with its school time", () => {
		const [day] = apprenticeReleaseDays([
			release({
				releaseKind: "vocational_school_day",
				startsOn: "2026-03-03",
				lessonCount: 4,
				schoolMinutes: 200,
			}),
		]);
		expect(day).toMatchObject({ credit: "school_minutes", minutes: 200 });
	});

	it("credits a block week of at least 25 h over at least five days as a full week", () => {
		const days = apprenticeReleaseDays([
			release({
				releaseKind: "vocational_school_block_week",
				startsOn: "2026-03-09",
				endsOn: "2026-03-13",
				schoolMinutes: 1500,
			}),
		]);
		expect(days.map((day) => [day.date, day.credit])).toEqual([
			["2026-03-09", "full_day"],
			["2026-03-10", "full_day"],
			["2026-03-11", "full_day"],
			["2026-03-12", "full_day"],
			["2026-03-13", "full_day"],
		]);
	});

	it("credits a two-week block per school week, Monday to Friday only", () => {
		// Mon 2 Mar – Fri 13 Mar 2026: two full school weeks with a weekend in between.
		const days = apprenticeReleaseDays([
			release({
				releaseKind: "vocational_school_block_week",
				startsOn: "2026-03-02",
				endsOn: "2026-03-13",
				schoolMinutes: 1500,
			}),
		]);
		expect(days.map((day) => [day.date, day.credit])).toEqual(
			[
				"2026-03-02",
				"2026-03-03",
				"2026-03-04",
				"2026-03-05",
				"2026-03-06",
				"2026-03-09",
				"2026-03-10",
				"2026-03-11",
				"2026-03-12",
				"2026-03-13",
			].map((date) => [date, "full_day"]),
		);
	});

	it("does not credit a Wednesday-to-Sunday block as a full week", () => {
		const days = apprenticeReleaseDays([
			release({
				releaseKind: "vocational_school_block_week",
				startsOn: "2026-03-04",
				endsOn: "2026-03-08",
				schoolMinutes: 1500,
			}),
		]);
		// Three school days: the week's school time spread over them, nothing on the weekend.
		expect(days.map((day) => [day.date, day.credit, day.minutes])).toEqual([
			["2026-03-04", "school_minutes", 500],
			["2026-03-05", "school_minutes", 500],
			["2026-03-06", "school_minutes", 500],
		]);
	});

	it("spreads a shorter block week's school time over its days", () => {
		const days = apprenticeReleaseDays([
			release({
				releaseKind: "vocational_school_block_week",
				startsOn: "2026-03-09",
				endsOn: "2026-03-12",
				schoolMinutes: 1200,
			}),
		]);
		expect(days.map((day) => [day.credit, day.minutes])).toEqual(
			Array.from({ length: 4 }, () => ["school_minutes", 300]),
		);
	});

	it("credits an exam with its recorded participation time, the day before the exam in full", () => {
		const days = apprenticeReleaseDays([
			release({ releaseKind: "pre_exam_day", startsOn: "2026-05-11" }),
			release({
				releaseKind: "exam_day",
				startsOn: "2026-05-12",
				schoolMinutes: 180,
				examStartTime: "08:00",
			}),
		]);
		expect(days.map((day) => [day.date, day.credit, day.minutes])).toEqual([
			["2026-05-11", "full_day", null],
			["2026-05-12", "school_minutes", 180],
		]);
	});

	it("credits exam and pre-exam days as full days", () => {
		const days = apprenticeReleaseDays([
			release({ releaseKind: "pre_exam_day", startsOn: "2026-05-11" }),
			release({ releaseKind: "exam_day", startsOn: "2026-05-12" }),
		]);
		expect(days.map((day) => day.credit)).toEqual(["full_day", "full_day"]);
	});
});

describe("applyApprenticeReleaseCredits", () => {
	it("releases required time without ever going below zero", () => {
		const requirements = requirementsOf({
			"2026-03-02": 480,
			"2026-03-03": 480,
			"2026-03-05": 180,
		});
		const credited = applyApprenticeReleaseCredits(
			requirements,
			apprenticeReleaseDays([
				release({ releaseKind: "vocational_school_day", startsOn: "2026-03-03", lessonCount: 7 }),
				release({
					releaseKind: "vocational_school_day",
					startsOn: "2026-03-05",
					lessonCount: 5,
				}),
			]),
		);
		expect(credited["2026-03-02"]?.requiredMinutes).toBe(480);
		expect(credited["2026-03-03"]?.requiredMinutes).toBe(0);
		// 5 × 45 = 225 school minutes exceed the 180 required: credited down to zero, not below.
		expect(credited["2026-03-05"]?.requiredMinutes).toBe(0);
	});
});
