import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { submissionCadenceStatusAt } from "./cadence";

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
