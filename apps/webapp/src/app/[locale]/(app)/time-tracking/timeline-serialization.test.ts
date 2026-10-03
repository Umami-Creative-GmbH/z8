import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { serializeWorkdayTimelineResult } from "./timeline-serialization";
import type {
	SelectedWorkdayDate,
	WorkdayTimelineResult,
} from "./workday-timeline.types";

const serializableDate = {
	dateKey: "2026-03-29",
	todayDateKey: "2026-03-30",
	previousDateKey: "2026-03-28",
	nextDateKey: "2026-03-30",
	label: "Sunday, March 29",
};
const selectedDate: SelectedWorkdayDate = {
	...serializableDate,
	startUtc: DateTime.fromISO("2026-03-28T23:00:00Z"),
	endUtc: DateTime.fromISO("2026-03-29T21:59:59.999Z"),
};
const serializableWarning = {
	id: "warning-1",
	type: "warning",
	title: "Missing clock out",
	subtitle: "Review this period",
	startLabel: undefined,
	endLabel: undefined,
	badge: "Pending",
	severity: "warning",
	link: { label: "Review", href: "/de/time-tracking?date=2026-03-29" },
} as const;

describe("serializeWorkdayTimelineResult", () => {
	it("preserves display fields, flags, warnings and links while dropping internal date and item fields", () => {
		const successFixture: WorkdayTimelineResult = {
			success: true,
			data: {
				selectedDate,
				hasScheduledContext: false,
				hasRecordedActivity: true,
				items: [
					{
						id: "period-1",
						type: "work-period",
						title: "Recorded work",
						subtitle: "Approved",
						startTime: new Date("2026-03-29T00:30:00Z"),
						endTime: new Date("2026-03-29T02:30:00Z"),
						startLabel: "01:30",
						endLabel: "04:30",
						badge: "2h",
						severity: "info",
						link: {
							label: "Details",
							href: "/de/time-tracking?date=2026-03-29",
						},
						isActive: false,
						durationMinutes: 120,
						approvalStatus: "approved",
						wasAutoAdjusted: false,
						autoAdjustmentReason: null,
					},
				],
				dayWarnings: [
					{
						...serializableWarning,
						startTime: new Date("2026-03-29T00:30:00Z"),
					},
				],
			},
		};
		const serializableFixture = {
			success: true,
			data: {
				selectedDate: serializableDate,
				hasScheduledContext: false,
				hasRecordedActivity: true,
				items: [
					{
						id: "period-1",
						type: "work-period",
						title: "Recorded work",
						subtitle: "Approved",
						startLabel: "01:30",
						endLabel: "04:30",
						badge: "2h",
						severity: "info",
						link: {
							label: "Details",
							href: "/de/time-tracking?date=2026-03-29",
						},
					},
				],
				dayWarnings: [serializableWarning],
			},
		};
		expect(serializeWorkdayTimelineResult(successFixture)).toEqual(
			serializableFixture,
		);
	});

	it("preserves error and selected date navigation fields without internal date objects", () => {
		expect(
			serializeWorkdayTimelineResult({
				success: false,
				selectedDate,
				error: "Timeline unavailable",
			}),
		).toEqual({
			success: false,
			selectedDate: serializableDate,
			error: "Timeline unavailable",
		});
	});

	it("preserves empty item lists and optional display values", () => {
		expect(
			serializeWorkdayTimelineResult({
				success: true,
				data: {
					selectedDate,
					items: [{ id: "break-1", type: "break", title: "Break" }],
					dayWarnings: [],
					hasScheduledContext: true,
					hasRecordedActivity: false,
				},
			}),
		).toEqual({
			success: true,
			data: {
				selectedDate: serializableDate,
				items: [
					{
						id: "break-1",
						type: "break",
						title: "Break",
						subtitle: undefined,
						startLabel: undefined,
						endLabel: undefined,
						badge: undefined,
						severity: undefined,
						link: undefined,
					},
				],
				dayWarnings: [],
				hasScheduledContext: true,
				hasRecordedActivity: false,
			},
		});
	});
});
