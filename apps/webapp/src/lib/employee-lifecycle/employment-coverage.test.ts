import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	clipRequirementsToEmployment,
	isDateKeyEmployed,
} from "./employment-coverage";

const period = (startedAt: string | null, endedAt: string | null) => ({
	startedAt: startedAt ? parseInstant(startedAt) : null,
	endedAt: endedAt ? parseInstant(endedAt) : null,
});

describe("isDateKeyEmployed", () => {
	it("treats the last working day as employed and the following day as not", () => {
		// Berlin departure: last working day 2026-09-30, cutoff at local midnight.
		const coverage = [period("2026-01-01T00:00:00Z", "2026-09-30T22:00:00Z")];

		expect(isDateKeyEmployed(coverage, "2026-09-30", "Europe/Berlin")).toBe(
			true,
		);
		expect(isDateKeyEmployed(coverage, "2026-10-01", "Europe/Berlin")).toBe(
			false,
		);
	});

	it("keeps the partial day of an immediate departure", () => {
		const coverage = [period("2026-01-01T00:00:00Z", "2026-09-14T09:30:00Z")];

		expect(isDateKeyEmployed(coverage, "2026-09-14", "UTC")).toBe(true);
		expect(isDateKeyEmployed(coverage, "2026-09-15", "UTC")).toBe(false);
	});

	it("excludes the gap between two employment periods", () => {
		const coverage = [
			period("2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"),
			period("2026-06-10T12:00:00Z", null),
		];

		expect(isDateKeyEmployed(coverage, "2026-02-28", "UTC")).toBe(true);
		expect(isDateKeyEmployed(coverage, "2026-04-15", "UTC")).toBe(false);
		expect(isDateKeyEmployed(coverage, "2026-06-10", "UTC")).toBe(true);
		expect(isDateKeyEmployed(coverage, "2027-01-01", "UTC")).toBe(true);
	});

	it("does not bound an unknown legacy start", () => {
		const coverage = [period(null, "2026-03-01T00:00:00Z")];

		expect(isDateKeyEmployed(coverage, "1999-01-01", "UTC")).toBe(true);
		expect(isDateKeyEmployed(coverage, "2026-03-01", "UTC")).toBe(false);
	});

	it("evaluates the day in the selected employee's zone across offset changes", () => {
		// 2026-10-25 is 25 hours long in Berlin; the cutoff falls at its end.
		const coverage = [period("2026-01-01T00:00:00Z", "2026-10-25T23:00:00Z")];

		expect(isDateKeyEmployed(coverage, "2026-10-25", "Europe/Berlin")).toBe(
			true,
		);
		expect(isDateKeyEmployed(coverage, "2026-10-26", "Europe/Berlin")).toBe(
			false,
		);
	});
});

describe("clipRequirementsToEmployment", () => {
	const requirement = {
		requiredMinutes: 480,
		policyId: "p",
		policyName: "Standard",
	};
	const requirements = {
		"2026-09-30": requirement,
		"2026-10-01": requirement,
	};

	it("drops requirement days outside employment", () => {
		const coverage = [period("2026-01-01T00:00:00Z", "2026-09-30T22:00:00Z")];

		expect(
			clipRequirementsToEmployment(requirements, coverage, "Europe/Berlin"),
		).toEqual({
			"2026-09-30": requirement,
		});
	});

	it("leaves requirements untouched without lifecycle coverage", () => {
		expect(
			clipRequirementsToEmployment(requirements, null, "Europe/Berlin"),
		).toBe(requirements);
	});

	it("falls back to UTC day keys for an invalid zone like the requirement builder", () => {
		const coverage = [period(null, "2026-10-01T00:00:00Z")];

		expect(
			clipRequirementsToEmployment(requirements, coverage, "Not/AZone"),
		).toEqual({
			"2026-09-30": requirement,
		});
	});
});
