import { describe, expect, it } from "vitest";
import {
	parseMyRequestsFocus,
	parseTimeTrackingFocus,
	periodBlockerHref,
	periodSubmissionBlockerKey,
} from "./blocker-navigation";
import type { PeriodSubmissionBlocker } from "./submission-blockers";

const PERIOD = { startDate: "2026-03-02", endDate: "2026-03-08" };

function work(
	kind: "live_work" | "time_correction" | "manual_work",
	startTime: string,
	timezone = "Europe/Berlin",
): PeriodSubmissionBlocker {
	return { kind, workPeriodId: "w-1", startTime, endTime: null, timezone };
}

describe("periodBlockerHref", () => {
	it("opens a time correction in the employee's own requests", () => {
		expect(periodBlockerHref(work("time_correction", "2026-03-04T08:00:00Z"), PERIOD)).toBe(
			"/my-requests?request=time_correction%3Aw-1",
		);
	});

	it("opens an absence request in the employee's own requests", () => {
		const absence: PeriodSubmissionBlocker = {
			kind: "absence_request",
			absenceId: "a-1",
			startDate: "2026-03-05",
			endDate: "2026-03-06",
		};
		expect(periodBlockerHref(absence, PERIOD)).toBe("/my-requests?request=absence%3Aa-1");
	});

	it("opens pending manual work on its day in the period's zone, never in My Requests", () => {
		// 23:30 UTC on the 3rd is already the 4th in Berlin.
		expect(periodBlockerHref(work("manual_work", "2026-03-03T23:30:00Z"), PERIOD)).toBe(
			"/time-tracking?date=2026-03-04&focus=manual_work%3Aw-1",
		);
		expect(
			periodBlockerHref(work("manual_work", "2026-03-03T23:30:00Z", "America/New_York"), PERIOD),
		).toBe("/time-tracking?date=2026-03-03&focus=manual_work%3Aw-1");
	});

	it("opens manual work crossing the period start on the period's first day", () => {
		// Started on the 1st at 22:00 Berlin, before the period; it reaches into the 2nd.
		expect(periodBlockerHref(work("manual_work", "2026-03-01T21:00:00Z"), PERIOD)).toBe(
			"/time-tracking?date=2026-03-02&focus=manual_work%3Aw-1",
		);
	});

	it("opens live work at the clock controls", () => {
		expect(periodBlockerHref(work("live_work", "2026-03-04T08:00:00Z"), PERIOD)).toBe(
			"/time-tracking?focus=live_work%3Aw-1",
		);
	});
});

describe("periodSubmissionBlockerKey", () => {
	it("names a blocker by its kind and source", () => {
		expect(periodSubmissionBlockerKey(work("manual_work", "2026-03-04T08:00:00Z"))).toBe(
			"manual_work:w-1",
		);
		expect(
			periodSubmissionBlockerKey({
				kind: "absence_request",
				absenceId: "a-1",
				startDate: "2026-03-05",
				endDate: "2026-03-05",
			}),
		).toBe("absence:a-1");
	});
});

describe("focus parameters", () => {
	it("reads a request focus for corrections and absences only", () => {
		expect(parseMyRequestsFocus("time_correction:w-1")).toEqual({
			sourceType: "time_correction",
			sourceId: "w-1",
		});
		expect(parseMyRequestsFocus("absence:a-1")).toEqual({ sourceType: "absence", sourceId: "a-1" });
		expect(parseMyRequestsFocus("travel_expense:t-1")).toBeNull();
		expect(parseMyRequestsFocus("manual_work:w-1")).toBeNull();
	});

	it("reads a time-tracking focus for manual and live work only", () => {
		expect(parseTimeTrackingFocus("manual_work:w-1")).toEqual({
			kind: "manual_work",
			workPeriodId: "w-1",
			key: "manual_work:w-1",
		});
		expect(parseTimeTrackingFocus("live_work:w-1")).toEqual({
			kind: "live_work",
			workPeriodId: "w-1",
			key: "live_work:w-1",
		});
		expect(parseTimeTrackingFocus("time_correction:w-1")).toBeNull();
	});

	it("ignores missing and malformed values", () => {
		for (const value of [
			undefined,
			null,
			"",
			"absence",
			"absence:",
			"absence:a b",
			"absence:<script>",
			`absence:${"x".repeat(200)}`,
			["absence:a-1"],
		]) {
			expect(parseMyRequestsFocus(value)).toBeNull();
			expect(parseTimeTrackingFocus(value)).toBeNull();
		}
	});
});
