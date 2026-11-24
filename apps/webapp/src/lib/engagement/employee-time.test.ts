import { describe, expect, it } from "vitest";
import type { EmploymentPeriodSnapshot } from "@/lib/contracts/resolve-contract";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { EngagementKind } from "./engagement-kind";
import { employeeTimeWithin } from "./employee-time";

function period(
	engagementKind: EngagementKind,
	startedAt: string | null,
	endedAt: string | null,
	startProvenance = "recorded",
): EmploymentPeriodSnapshot {
	return {
		id: `${engagementKind}-${startedAt}`,
		employeeId: "person",
		status: endedAt ? "closed" : "open",
		startedAt: startedAt ? parseInstant(startedAt) : null,
		startProvenance,
		endedAt: endedAt ? parseInstant(endedAt) : null,
		createdAt: parseInstant("2026-01-01T00:00:00Z"),
		engagementKind,
	};
}

function within(
	periods: EmploymentPeriodSnapshot[],
	start: string,
	endExclusive: string,
	employeeEngagementKind: EngagementKind = "employee",
) {
	return employeeTimeWithin(
		{ periods, employeeEngagementKind },
		{ start: parseInstant(start), endExclusive: parseInstant(endExclusive) },
	).map((range) => [range.start.toString(), range.endExclusive.toString()]);
}

describe("employee time within a window (#1997)", () => {
	it("is the whole window for an employee without recorded stints", () => {
		expect(within([], "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z")).toEqual([
			["2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"],
		]);
	});

	it("is nothing for an External Contractor without recorded stints", () => {
		expect(within([], "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z", "contractor")).toEqual([]);
	});

	it("is nothing inside a contractor stint", () => {
		const stints = [period("contractor", "2026-01-01T00:00:00Z", null)];

		expect(within(stints, "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z")).toEqual([]);
	});

	it("splits a conversion day at the instant the employee stint starts", () => {
		const stints = [
			period("contractor", "2026-01-01T00:00:00Z", "2026-04-01T10:00:00Z"),
			period("employee", "2026-04-01T10:00:00Z", null),
		];

		expect(within(stints, "2026-04-01T00:00:00Z", "2026-04-02T00:00:00Z")).toEqual([
			["2026-04-01T10:00:00Z", "2026-04-02T00:00:00Z"],
		]);
	});

	it("splits a conversion the other way at the instant the employee stint ends", () => {
		const stints = [
			period("employee", "2026-01-01T00:00:00Z", "2026-04-01T10:00:00Z"),
			period("contractor", "2026-04-01T10:00:00Z", null),
		];

		expect(within(stints, "2026-03-31T00:00:00Z", "2026-04-02T00:00:00Z")).toEqual([
			["2026-03-31T00:00:00Z", "2026-04-01T10:00:00Z"],
		]);
	});

	it("gives a gap between stints the kind of the stint that ended before it", () => {
		const stints = [
			period("contractor", "2026-01-01T00:00:00Z", "2026-03-10T00:00:00Z"),
			period("employee", "2026-03-20T00:00:00Z", "2026-03-25T00:00:00Z"),
		];

		expect(within(stints, "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z")).toEqual([
			["2026-03-20T00:00:00Z", "2026-04-01T00:00:00Z"],
		]);
	});

	it("gives the time before the first stint the kind of that stint", () => {
		const stints = [period("contractor", "2026-03-15T00:00:00Z", null)];

		expect(within(stints, "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z", "employee")).toEqual([]);
	});

	it("treats a stint without a recorded start as open towards the past", () => {
		const stints = [
			period("contractor", "2026-03-15T00:00:00Z", "2026-03-20T00:00:00Z", "legacy_unknown"),
			period("employee", "2026-03-20T00:00:00Z", null),
		];

		expect(within(stints, "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z")).toEqual([
			["2026-03-20T00:00:00Z", "2026-04-01T00:00:00Z"],
		]);
	});

	it("never counts time a contractor stint overlaps as employee time", () => {
		const stints = [
			period("employee", "2026-01-01T00:00:00Z", null),
			period("contractor", "2026-03-10T00:00:00Z", "2026-03-12T00:00:00Z"),
		];

		expect(within(stints, "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z")).toEqual([
			["2026-03-01T00:00:00Z", "2026-03-10T00:00:00Z"],
			["2026-03-12T00:00:00Z", "2026-04-01T00:00:00Z"],
		]);
	});

	it("is the instant itself for an empty window in employee time, and nothing in contractor time", () => {
		const stints = [
			period("contractor", "2026-01-01T00:00:00Z", "2026-04-01T10:00:00Z"),
			period("employee", "2026-04-01T10:00:00Z", null),
		];

		expect(within(stints, "2026-04-01T12:00:00Z", "2026-04-01T12:00:00Z")).toEqual([
			["2026-04-01T12:00:00Z", "2026-04-01T12:00:00Z"],
		]);
		expect(within(stints, "2026-04-01T09:00:00Z", "2026-04-01T09:00:00Z")).toEqual([]);
	});
});
