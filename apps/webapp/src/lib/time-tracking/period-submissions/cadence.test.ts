import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	collectsPeriodSubmissions,
	daysAroundForEveryZone,
	submissionCadenceStatusAt,
} from "./cadence";

const at = (value: string) => Temporal.Instant.from(value);

describe("submissionCadenceStatusAt", () => {
	it("is off with nothing upcoming for an organization that never saved a cadence", () => {
		expect(submissionCadenceStatusAt([], "Europe/Berlin", at("2026-03-04T10:00:00Z"))).toEqual({
			inEffect: { kind: "off" },
			upcoming: null,
		});
	});

	it("reports a switch-on as upcoming until its first full period starts", () => {
		const history = [
			{
				cadence: { kind: "weekly", weekStartDay: "monday" } as const,
				changedAt: at("2026-03-04T10:00:00Z"),
			},
		];
		expect(submissionCadenceStatusAt(history, "Europe/Berlin", at("2026-03-05T10:00:00Z"))).toEqual(
			{
				inEffect: { kind: "off" },
				upcoming: {
					cadence: { kind: "weekly", weekStartDay: "monday" },
					fromDate: parsePlainDate("2026-03-09"),
				},
			},
		);
		expect(submissionCadenceStatusAt(history, "Europe/Berlin", at("2026-03-09T10:00:00Z"))).toEqual(
			{
				inEffect: { kind: "weekly", weekStartDay: "monday" },
				upcoming: null,
			},
		);
	});

	it("reports a cadence change as upcoming while the old cadence stays in effect", () => {
		const history = [
			{
				cadence: { kind: "weekly", weekStartDay: "monday" } as const,
				changedAt: at("2026-03-04T10:00:00Z"),
			},
			{ cadence: { kind: "monthly" } as const, changedAt: at("2026-03-20T10:00:00Z") },
		];
		expect(submissionCadenceStatusAt(history, "Europe/Berlin", at("2026-04-15T10:00:00Z"))).toEqual(
			{
				inEffect: { kind: "weekly", weekStartDay: "monday" },
				upcoming: { cadence: { kind: "monthly" }, fromDate: parsePlainDate("2026-06-01") },
			},
		);
	});
});

describe("collectsPeriodSubmissions", () => {
	const collectsAt = (
		history: Parameters<typeof submissionCadenceStatusAt>[0],
		now: string,
	): boolean =>
		collectsPeriodSubmissions(submissionCadenceStatusAt(history, "Europe/Berlin", at(now)));
	const weeklyOn = {
		cadence: { kind: "weekly", weekStartDay: "monday" } as const,
		changedAt: at("2026-03-04T10:00:00Z"),
	};

	it("is false for an organization that never saved a cadence", () => {
		expect(collectsAt([], "2026-03-04T10:00:00Z")).toBe(false);
	});

	it("is true once a cadence is scheduled, before its first period starts", () => {
		expect(collectsAt([weeklyOn], "2026-03-05T10:00:00Z")).toBe(true);
	});

	it("is true while a cadence is in effect", () => {
		expect(collectsAt([weeklyOn], "2026-03-10T10:00:00Z")).toBe(true);
	});

	it("stays true until a switch-off takes effect, then turns false", () => {
		// Switched off on Wednesday: the current week still has to be submitted.
		const history = [
			weeklyOn,
			{ cadence: { kind: "off" } as const, changedAt: at("2026-03-11T10:00:00Z") },
		];
		expect(collectsAt(history, "2026-03-12T10:00:00Z")).toBe(true);
		expect(collectsAt(history, "2026-03-16T10:00:00Z")).toBe(false);
	});
});

describe("daysAroundForEveryZone", () => {
	it("widens the UTC days by a day on each side, so every zone's days are covered", () => {
		const window = daysAroundForEveryZone(Temporal.Instant.from("2026-03-10T23:30:00Z"), {
			before: 7,
			after: 0,
		});
		// It is already 11 March east of UTC and still 10 March far west of it.
		expect([window.from.toString(), window.to.toString()]).toEqual(["2026-03-02", "2026-03-11"]);
	});
});
