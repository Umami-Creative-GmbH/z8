import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { SelectedWorkdayDate } from "./workday-timeline.types";
import {
	normalizeWorkdayTimeline,
	type NormalizeWorkdayTimelineInput,
} from "./workday-timeline-normalize";

const selectedDate: SelectedWorkdayDate = {
	dateKey: "2026-05-03",
	todayDateKey: "2026-05-03",
	previousDateKey: "2026-05-02",
	nextDateKey: "2026-05-04",
	label: "May 3, 2026",
	startUtc: DateTime.fromISO("2026-05-02T22:00:00.000Z"),
	endUtc: DateTime.fromISO("2026-05-03T21:59:59.999Z"),
};

describe("normalizeWorkdayTimeline", () => {
	it("orders day warnings and all-day context before timed timeline items", () => {
		const result = normalizeWorkdayTimeline({
			selectedDate,
			timezone: "Europe/Berlin",
			workPeriods: [
				{
					id: "period-1",
					startTime: new Date("2026-05-03T07:00:00.000Z"),
					endTime: new Date("2026-05-03T15:00:00.000Z"),
					durationMinutes: 480,
					approvalStatus: "approved",
					pendingChanges: null,
					wasAutoAdjusted: false,
					autoAdjustmentReason: null,
				},
			],
			shifts: [
				{
					id: "shift-1",
					date: "2026-05-03",
					startTime: "08:00",
					endTime: "16:00",
					status: "published",
					notes: "Front desk",
				},
			],
			absences: [
				{
					id: "absence-1",
					startDate: "2026-05-03",
					endDate: "2026-05-03",
					startPeriod: "morning",
					endPeriod: "morning",
					status: "approved",
					categoryName: "Doctor appointment",
					categoryColor: "#2563eb",
				},
			],
			pendingRequests: [],
		});

		expect(result.items.map((item) => item.type)).toEqual([
			"absence",
			"shift",
			"work-period",
		]);
		expect(result.hasScheduledContext).toBe(true);
		expect(result.hasRecordedActivity).toBe(true);
	});

	it("adds warning rows for pending edits, active periods, and auto adjustments", () => {
		const result = normalizeWorkdayTimeline({
			selectedDate,
			timezone: "Europe/Berlin",
			workPeriods: [
				{
					id: "period-pending",
					startTime: new Date("2026-05-03T07:00:00.000Z"),
					endTime: null,
					durationMinutes: null,
					approvalStatus: "pending",
					pendingChanges: "{\"reason\":\"corrected clock out\"}",
					wasAutoAdjusted: true,
					autoAdjustmentReason: {
						breakInsertedMinutes: 30,
						regulationName: "Default break policy",
						originalDurationMinutes: 510,
					},
				},
			],
			shifts: [],
			absences: [],
			pendingRequests: [],
		});

		expect(result.dayWarnings.map((warning) => warning.id)).toEqual([
			"warning:pending-edit:period-pending",
			"warning:missing-clock-out:period-pending",
			"warning:auto-adjusted:period-pending",
		]);
		expect(result.dayWarnings[0].link).toEqual({
			label: "Review request",
			href: "/my-requests",
		});
	});

	it("keeps day warning summaries out of timeline items", () => {
		const result = normalizeWorkdayTimeline({
			selectedDate,
			timezone: "Europe/Berlin",
			workPeriods: [
				{
					id: "period-pending",
					startTime: new Date("2026-05-03T07:00:00.000Z"),
					endTime: null,
					durationMinutes: null,
					approvalStatus: "pending",
					pendingChanges: null,
					wasAutoAdjusted: false,
					autoAdjustmentReason: null,
				},
			],
			shifts: [],
			absences: [],
			pendingRequests: [],
		});

		expect(result.dayWarnings).toHaveLength(2);
		expect(result.items.map((item) => item.type)).toEqual(["work-period"]);
	});

	it("rolls overnight shift end times into the next day", () => {
		const result = normalizeWorkdayTimeline({
			selectedDate,
			timezone: "Europe/Berlin",
			workPeriods: [],
			shifts: [
				{
					id: "night-shift",
					date: "2026-05-03",
					startTime: "22:00",
					endTime: "06:00",
					status: "published",
					notes: null,
				},
			],
			absences: [],
			pendingRequests: [],
		});

		expect(result.items[0]).toMatchObject({
			startTime: DateTime.fromISO("2026-05-03T22:00", {
				zone: "Europe/Berlin",
			}).toJSDate(),
			endTime: DateTime.fromISO("2026-05-04T06:00", {
				zone: "Europe/Berlin",
			}).toJSDate(),
		});
	});

	it("orders same-start timed items by type priority then id", () => {
		const sameStart = new Date("2026-05-03T08:00:00.000Z");
		const input: NormalizeWorkdayTimelineInput = {
			selectedDate,
			timezone: "Europe/Berlin",
			workPeriods: [
				{
					id: "z-period",
					startTime: sameStart,
					endTime: new Date("2026-05-03T12:00:00.000Z"),
					durationMinutes: 240,
					approvalStatus: "approved",
					pendingChanges: null,
					wasAutoAdjusted: false,
					autoAdjustmentReason: null,
				},
			],
			shifts: [
				{
					id: "b-shift",
					date: "2026-05-03",
					startTime: "10:00",
					endTime: "18:00",
					status: "published",
					notes: null,
				},
				{
					id: "a-shift",
					date: "2026-05-03",
					startTime: "10:00",
					endTime: "18:00",
					status: "published",
					notes: null,
				},
			],
			absences: [],
			pendingRequests: [
				{
					id: "time_correction:a-request",
					sourceType: "time_correction",
					status: "pending",
					title: "time_correction",
					subtitle: "time_entry_correction",
					submittedAt: sameStart,
					sourceHref: "/time-tracking",
				},
			],
		};

		const result = normalizeWorkdayTimeline(input);

		expect(result.items.map((item) => item.id)).toEqual([
			"shift:a-shift",
			"shift:b-shift",
			"work-period:z-period",
			"pending-request:time_correction:a-request",
		]);
	});

	it("keeps only pending requests and ignores travel expenses for the workday timeline", () => {
		const result = normalizeWorkdayTimeline({
			selectedDate,
			timezone: "Europe/Berlin",
			workPeriods: [],
			shifts: [],
			absences: [],
			pendingRequests: [
				{
					id: "time_correction:req-1",
					sourceType: "time_correction",
					status: "pending",
					title: "time_correction",
					subtitle: "time_entry_correction",
					submittedAt: new Date("2026-05-03T08:00:00.000Z"),
					sourceHref: "/time-tracking",
				},
				{
					id: "travel_expense:req-2",
					sourceType: "travel_expense",
					status: "pending",
					title: "travel_expense",
					subtitle: "Trip",
					submittedAt: new Date("2026-05-03T08:00:00.000Z"),
					sourceHref: "/travel-expenses",
				},
			],
		});

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			type: "pending-request",
			sourceType: "time_correction",
		});
	});
});
