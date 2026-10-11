import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { periodChangeTouches, type SubmittedPeriodRange } from "./period-change";

const instant = (value: string) => Temporal.Instant.from(value);

// The week 2026-03-02..08 in Europe/Berlin (UTC+1): [03-01T23:00Z, 03-08T23:00Z).
const week: SubmittedPeriodRange = {
	startDate: "2026-03-02",
	endDate: "2026-03-08",
	rangeStart: instant("2026-03-01T23:00:00Z"),
	rangeEnd: instant("2026-03-08T23:00:00Z"),
};

describe("whether a change touches a submitted period", () => {
	it("counts work inside the period", () => {
		expect(
			periodChangeTouches(
				{
					work: [{ start: instant("2026-03-04T08:00:00Z"), end: instant("2026-03-04T16:00:00Z") }],
				},
				week,
			),
		).toBe(true);
	});

	it("counts work that touches the period only in part", () => {
		// Night shift from Sunday 2026-03-01 22:00 Berlin into the period.
		expect(
			periodChangeTouches(
				{
					work: [{ start: instant("2026-03-01T21:00:00Z"), end: instant("2026-03-02T05:00:00Z") }],
				},
				week,
			),
		).toBe(true);
	});

	it("ignores work entirely before or after the period", () => {
		expect(
			periodChangeTouches(
				{
					work: [
						{ start: instant("2026-02-27T08:00:00Z"), end: instant("2026-02-27T16:00:00Z") },
						{ start: instant("2026-03-08T23:00:00Z"), end: instant("2026-03-09T07:00:00Z") },
					],
				},
				week,
			),
		).toBe(false);
	});

	it("counts the work before a change when only the work after it lies outside", () => {
		expect(
			periodChangeTouches(
				{
					work: [
						{ start: instant("2026-03-06T08:00:00Z"), end: instant("2026-03-06T16:00:00Z") },
						{ start: instant("2026-03-10T08:00:00Z"), end: instant("2026-03-10T16:00:00Z") },
					],
				},
				week,
			),
		).toBe(true);
	});

	it("counts live work started in the period, but not live work started after it", () => {
		expect(
			periodChangeTouches({ work: [{ start: instant("2026-03-08T15:00:00Z"), end: null }] }, week),
		).toBe(true);
		expect(
			periodChangeTouches({ work: [{ start: instant("2026-03-09T07:00:00Z"), end: null }] }, week),
		).toBe(false);
	});

	it("counts absence days overlapping the period, even one day of it", () => {
		expect(
			periodChangeTouches({ days: [{ startDate: "2026-03-08", endDate: "2026-03-12" }] }, week),
		).toBe(true);
		expect(
			periodChangeTouches({ days: [{ startDate: "2026-02-23", endDate: "2026-03-02" }] }, week),
		).toBe(true);
	});

	it("ignores absence days outside the period", () => {
		expect(
			periodChangeTouches(
				{
					days: [
						{ startDate: "2026-02-23", endDate: "2026-03-01" },
						{ startDate: "2026-03-09", endDate: "2026-03-09" },
					],
				},
				week,
			),
		).toBe(false);
	});

	it("ignores an empty change", () => {
		expect(periodChangeTouches({}, week)).toBe(false);
	});
});
