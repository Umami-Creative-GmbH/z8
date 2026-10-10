import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkDateRange, checkInstantRange, dateRangeShape, instantRangeShape } from "./date-range";

const instants = z.object(instantRangeShape).superRefine(checkInstantRange);
const dates = z.object(dateRangeShape).superRefine(checkDateRange);

const messages = (result: { success: boolean; error?: z.ZodError }) =>
	result.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) ?? [];

describe("Public API date ranges", () => {
	it("accepts instant ranges up to 366 days, in any offset", () => {
		expect(
			instants.safeParse({ from: "2026-01-01T00:00:00Z", to: "2027-01-02T00:00:00Z" }).success,
		).toBe(true);
		expect(
			instants.safeParse({ from: "2026-01-01T02:00:00+02:00", to: "2026-01-01T01:00:01Z" }).success,
		).toBe(true);
	});

	it("refuses missing, reversed and over-long instant ranges", () => {
		expect(messages(instants.safeParse({}))).toHaveLength(2);
		expect(
			messages(instants.safeParse({ from: "2026-02-01T00:00:00Z", to: "2026-02-01T00:00:00Z" })),
		).toEqual(["to: `to` must be after `from`"]);
		expect(
			messages(instants.safeParse({ from: "2026-01-01T00:00:00Z", to: "2027-01-02T00:00:01Z" })),
		).toEqual(["to: The range may span at most 366 days"]);
		expect(instants.safeParse({ from: "yesterday", to: "2026-01-01T00:00:00Z" }).success).toBe(
			false,
		);
	});

	it("treats date ranges as inclusive calendar days", () => {
		expect(dates.safeParse({ from: "2026-03-01", to: "2026-03-01" }).success).toBe(true);
		expect(dates.safeParse({ from: "2026-01-01", to: "2027-01-02" }).success).toBe(true);
		expect(messages(dates.safeParse({ from: "2026-01-01", to: "2027-01-03" }))).toEqual([
			"to: The range may span at most 366 days",
		]);
		expect(messages(dates.safeParse({ from: "2026-03-02", to: "2026-03-01" }))).toEqual([
			"to: `to` must not be before `from`",
		]);
		expect(dates.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
	});
});
