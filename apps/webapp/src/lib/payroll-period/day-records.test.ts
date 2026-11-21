import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { attributeRecordsToLocalDays, type PayrollPeriodRecordSource } from "./day-records";

const now = Temporal.Instant.from("2026-12-01T00:00:00Z");

function record(
	id: string,
	startAt: string,
	endAt: string | null,
	overrides: Partial<PayrollPeriodRecordSource> = {},
): PayrollPeriodRecordSource {
	const start = Temporal.Instant.from(startAt);
	const end = endAt ? Temporal.Instant.from(endAt) : null;
	return {
		id,
		kind: "work",
		approvalState: "approved",
		startAt: start,
		endAt: end,
		durationMinutes: end ? start.until(end).total("minutes") : null,
		isPaid: null,
		...overrides,
	};
}

/** Each day's records as `[id, start, end]`. */
function attributed(
	records: PayrollPeriodRecordSource[],
	options: { timezone: string; startDate: string; endDate: string; now?: Temporal.Instant },
) {
	return Object.fromEntries(
		[...attributeRecordsToLocalDays(records, { now, ...options })].map(([date, list]) => [
			date,
			list.map((item) => [item.id, item.start, item.end]),
		]),
	);
}

/** Whether an attributed `[id, start, end]` is a break read from a gap. */
const isGap = ([id]: (string | null)[]) => id?.startsWith("gap:") ?? false;

describe("attributeRecordsToLocalDays", () => {
	it("puts records on their local day with local wall-clock times, sorted by start", () => {
		expect(
			attributed(
				[
					record("afternoon", "2026-11-10T11:31:00Z", "2026-11-10T16:05:00Z"),
					record("morning", "2026-11-10T07:02:00Z", "2026-11-10T11:00:00Z"),
					record("lunch", "2026-11-10T11:00:00Z", "2026-11-10T11:31:00Z", {
						kind: "break",
						isPaid: true,
					}),
				],
				{ timezone: "Europe/Berlin", startDate: "2026-11-01", endDate: "2026-11-30" },
			),
		).toEqual({
			"2026-11-10": [
				["morning", "2026-11-10T08:02", "2026-11-10T12:00"],
				["lunch", "2026-11-10T12:00", "2026-11-10T12:31"],
				["afternoon", "2026-11-10T12:31", "2026-11-10T17:05"],
			],
		});
	});

	it("puts a record across local midnight on each day it touches, with its whole times", () => {
		// 22:00-06:00 Berlin on 9/10 November.
		const days = attributed([record("night", "2026-11-09T21:00:00Z", "2026-11-10T05:00:00Z")], {
			timezone: "Europe/Berlin",
			startDate: "2026-11-01",
			endDate: "2026-11-30",
		});

		expect(days).toEqual({
			"2026-11-09": [["night", "2026-11-09T22:00", "2026-11-10T06:00"]],
			"2026-11-10": [["night", "2026-11-09T22:00", "2026-11-10T06:00"]],
		});
	});

	it("attributes local days in the employee's zone, not UTC", () => {
		// 20:00-23:00 in New York on 10 November is 01:00-04:00 UTC on 11 November.
		expect(
			attributed([record("evening", "2026-11-11T01:00:00Z", "2026-11-11T04:00:00Z")], {
				timezone: "America/New_York",
				startDate: "2026-11-01",
				endDate: "2026-11-30",
			}),
		).toEqual({ "2026-11-10": [["evening", "2026-11-10T20:00", "2026-11-10T23:00"]] });
	});

	it("keeps a record that ends exactly at local midnight on its own day only", () => {
		// 18:00-24:00 Berlin on 10 November.
		expect(
			attributed([record("late", "2026-11-10T17:00:00Z", "2026-11-10T23:00:00Z")], {
				timezone: "Europe/Berlin",
				startDate: "2026-11-01",
				endDate: "2026-11-30",
			}),
		).toEqual({ "2026-11-10": [["late", "2026-11-10T18:00", "2026-11-11T00:00"]] });
	});

	it("reads local days across daylight saving time changes", () => {
		const days = attributeRecordsToLocalDays(
			[
				// Spring forward in Berlin, 29 March 2026: 00:30 CET to 03:30 CEST is two hours.
				record("spring", "2026-03-28T23:30:00Z", "2026-03-29T01:30:00Z"),
				// Fall back, 25 October 2026: 22:00 CEST on 24 October to 06:00 CET is nine hours.
				record("autumn", "2026-10-24T20:00:00Z", "2026-10-25T05:00:00Z"),
				// 25 October 18:00 CET to midnight: ends at 23:00 UTC, the start of 26 October.
				record("evening", "2026-10-25T17:00:00Z", "2026-10-25T23:00:00Z"),
			],
			{ timezone: "Europe/Berlin", startDate: "2026-03-01", endDate: "2026-10-31", now },
		);

		expect(days.get("2026-03-28")).toBeUndefined();
		expect(days.get("2026-03-29")).toMatchObject([
			{ id: "spring", start: "2026-03-29T00:30", end: "2026-03-29T03:30", durationMinutes: 120 },
		]);
		expect(days.get("2026-10-24")).toMatchObject([
			{ id: "autumn", start: "2026-10-24T22:00", end: "2026-10-25T06:00", durationMinutes: 540 },
		]);
		expect(days.get("2026-10-25")?.map((item) => item.id)).toEqual(["autumn", "evening"]);
		expect(days.get("2026-10-26")).toBeUndefined();
	});

	it("leaves out the days outside the period of a record that reaches past it", () => {
		// 22:00 on 31 October to 06:00 on 1 November Berlin; the period starts 1 November.
		expect(
			attributed([record("night", "2026-10-31T21:00:00Z", "2026-11-01T05:00:00Z")], {
				timezone: "Europe/Berlin",
				startDate: "2026-11-01",
				endDate: "2026-11-30",
			}),
		).toEqual({ "2026-11-01": [["night", "2026-10-31T22:00", "2026-11-01T06:00"]] });
	});

	it("shows a running record as open on the days up to now", () => {
		const days = attributeRecordsToLocalDays(
			[record("running", "2026-11-09T21:00:00Z", null, { approvalState: "draft" })],
			{
				timezone: "Europe/Berlin",
				startDate: "2026-11-01",
				endDate: "2026-11-30",
				now: Temporal.Instant.from("2026-11-11T09:00:00Z"),
			},
		);

		expect([...days.keys()]).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
		expect(days.get("2026-11-10")).toEqual([
			{
				id: "running",
				kind: "work",
				approvalState: "draft",
				start: "2026-11-09T22:00",
				end: null,
				durationMinutes: null,
				isPaid: null,
			},
		]);
	});

	it("reads a clocked break from the gap between two work records", () => {
		// A clocked break closes the work at 12:00 and resumes it at 12:31 Berlin.
		const days = attributeRecordsToLocalDays(
			[
				record("morning", "2026-11-10T07:02:00Z", "2026-11-10T11:00:00Z"),
				record("afternoon", "2026-11-10T11:31:00Z", "2026-11-10T16:05:00Z", {
					approvalState: "pending",
				}),
			],
			{ timezone: "Europe/Berlin", startDate: "2026-11-01", endDate: "2026-11-30", now },
		);

		expect(days.get("2026-11-10")).toEqual([
			expect.objectContaining({ id: "morning" }),
			{
				id: "gap:morning:afternoon",
				kind: "break",
				// The resumed work is pending, so the break is not approved yet either.
				approvalState: "pending",
				start: "2026-11-10T12:00",
				end: "2026-11-10T12:31",
				durationMinutes: 31,
				isPaid: false,
			},
			expect.objectContaining({ id: "afternoon" }),
		]);
	});

	it("counts only gaps of more than a minute, and lets overlapping work cover its gap", () => {
		const days = attributed(
			[
				record("a", "2026-11-10T07:00:00Z", "2026-11-10T09:00:00Z"),
				// One minute later: not a break.
				record("b", "2026-11-10T09:01:00Z", "2026-11-10T12:00:00Z"),
				// Starts inside b and reaches past c's start: no gap before c.
				record("c-cover", "2026-11-10T11:00:00Z", "2026-11-10T13:30:00Z"),
				record("c", "2026-11-10T13:00:00Z", "2026-11-10T14:00:00Z"),
				// Fifteen minutes after the latest end, 14:00 UTC.
				record("d", "2026-11-10T14:15:00Z", "2026-11-10T16:00:00Z"),
			],
			{ timezone: "Europe/Berlin", startDate: "2026-11-10", endDate: "2026-11-10" },
		);

		expect(days["2026-11-10"]?.filter(isGap)).toEqual([
			["gap:c:d", "2026-11-10T15:00", "2026-11-10T15:15"],
		]);
	});

	it("reads the break before a running record, and none after it", () => {
		const days = attributed(
			[
				record("morning", "2026-11-10T07:00:00Z", "2026-11-10T11:00:00Z"),
				record("running", "2026-11-10T11:30:00Z", null, { approvalState: "draft" }),
				record("odd", "2026-11-10T15:00:00Z", "2026-11-10T16:00:00Z"),
			],
			{
				timezone: "Europe/Berlin",
				startDate: "2026-11-10",
				endDate: "2026-11-10",
				now: Temporal.Instant.from("2026-11-10T17:00:00Z"),
			},
		);

		expect(days["2026-11-10"]?.filter(isGap)).toEqual([
			["gap:morning:running", "2026-11-10T12:00", "2026-11-10T12:30"],
		]);
	});

	it("leaves a gap a stored break record overlaps to that record, which knows if it is paid", () => {
		const days = attributeRecordsToLocalDays(
			[
				record("morning", "2026-11-10T07:00:00Z", "2026-11-10T11:00:00Z"),
				record("lunch", "2026-11-10T11:00:00Z", "2026-11-10T11:30:00Z", {
					kind: "break",
					isPaid: true,
				}),
				record("afternoon", "2026-11-10T11:30:00Z", "2026-11-10T15:00:00Z"),
			],
			{ timezone: "Europe/Berlin", startDate: "2026-11-10", endDate: "2026-11-10", now },
		);

		expect(
			days
				.get("2026-11-10")
				?.filter((item) => item.kind === "break")
				.map((item) => item.id),
		).toEqual(["lunch"]);
	});

	it("reads no break between work starting on different local days, as across midnight", () => {
		// 20:00-23:50 Berlin on 9 November, then 00:20-04:00 on 10 November.
		const days = attributed(
			[
				record("evening", "2026-11-09T19:00:00Z", "2026-11-09T22:50:00Z"),
				record("night", "2026-11-09T23:20:00Z", "2026-11-10T03:00:00Z"),
			],
			{ timezone: "Europe/Berlin", startDate: "2026-11-01", endDate: "2026-11-30" },
		);

		expect(Object.values(days).flat().filter(isGap)).toEqual([]);
	});

	it("reads a break after work that crossed midnight on the day both records start", () => {
		// Berlin: 23:00 on 9 November to 02:00 on 10 November starts on another day than
		// 02:30-04:00, so no break between them; 02:30-04:00 and 04:30-06:00 both start
		// on 10 November, so the 30 minutes between them are a break of that day.
		const days = attributed(
			[
				record("across", "2026-11-09T22:00:00Z", "2026-11-10T01:00:00Z"),
				record("early", "2026-11-10T01:30:00Z", "2026-11-10T03:00:00Z"),
				record("late", "2026-11-10T03:30:00Z", "2026-11-10T05:00:00Z"),
			],
			{ timezone: "Europe/Berlin", startDate: "2026-11-01", endDate: "2026-11-30" },
		);

		expect(days["2026-11-09"]?.map(([id]) => id)).toEqual(["across"]);
		expect(days["2026-11-10"]).toEqual([
			["across", "2026-11-09T23:00", "2026-11-10T02:00"],
			["early", "2026-11-10T02:30", "2026-11-10T04:00"],
			["gap:early:late", "2026-11-10T04:00", "2026-11-10T04:30"],
			["late", "2026-11-10T04:30", "2026-11-10T06:00"],
		]);
	});

	it("counts a break's elapsed minutes on daylight saving days", () => {
		const days = attributeRecordsToLocalDays(
			[
				// Spring forward, 29 March 2026 Berlin: 01:30 CET to 03:30 CEST is one hour.
				record("before-spring", "2026-03-28T23:00:00Z", "2026-03-29T00:30:00Z"),
				record("after-spring", "2026-03-29T01:30:00Z", "2026-03-29T04:00:00Z"),
				// Fall back, 25 October 2026: 02:30 CEST to 02:30 CET is one hour.
				record("before-fall", "2026-10-24T23:00:00Z", "2026-10-25T00:30:00Z"),
				record("after-fall", "2026-10-25T01:30:00Z", "2026-10-25T04:00:00Z"),
			],
			{ timezone: "Europe/Berlin", startDate: "2026-03-01", endDate: "2026-10-31", now },
		);
		const breakOf = (date: string) => days.get(date)?.find((item) => item.kind === "break");

		expect(breakOf("2026-03-29")).toMatchObject({
			start: "2026-03-29T01:30",
			end: "2026-03-29T03:30",
			durationMinutes: 60,
		});
		expect(breakOf("2026-10-25")).toMatchObject({
			start: "2026-10-25T02:30",
			end: "2026-10-25T02:30",
			durationMinutes: 60,
		});
	});

	it("marks breaks paid or unpaid and work as neither", () => {
		const days = attributeRecordsToLocalDays(
			[
				record("work", "2026-11-10T07:00:00Z", "2026-11-10T15:00:00Z", { isPaid: true }),
				record("break", "2026-11-10T11:00:00Z", "2026-11-10T11:30:00Z", {
					kind: "break",
					isPaid: null,
				}),
			],
			{ timezone: "Europe/Berlin", startDate: "2026-11-10", endDate: "2026-11-10", now },
		);

		expect(days.get("2026-11-10")?.map((item) => [item.id, item.isPaid])).toEqual([
			["work", null],
			["break", false],
		]);
	});
});
