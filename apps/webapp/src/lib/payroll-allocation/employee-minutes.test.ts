import { describe, expect, it } from "vitest";
import type { EmploymentPeriodSnapshot } from "@/lib/contracts/resolve-contract";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { EngagementStints } from "@/lib/engagement/employee-time";
import { allocateEmployeeMinutes } from "./employee-minutes";

const instant = parseInstant;

function stint(
	engagementKind: "employee" | "contractor",
	startedAt: string,
	endedAt: string | null,
): EmploymentPeriodSnapshot {
	return {
		id: `${engagementKind}-${startedAt}`,
		employeeId: "person",
		status: endedAt ? "closed" : "open",
		startedAt: instant(startedAt),
		startProvenance: "recorded",
		endedAt: endedAt ? instant(endedAt) : null,
		createdAt: instant("2026-01-01T00:00:00Z"),
		engagementKind,
	};
}

const employee: EngagementStints = { periods: [], employeeEngagementKind: "employee" };
/** Contractor until 12:00 UTC on 1 April 2026, employee from then on. */
const converted: EngagementStints = {
	periods: [
		stint("contractor", "2026-01-01T00:00:00Z", "2026-04-01T12:00:00Z"),
		stint("employee", "2026-04-01T12:00:00Z", null),
	],
	employeeEngagementKind: "employee",
};
const april = {
	start: instant("2026-04-01T00:00:00Z"),
	endExclusive: instant("2026-05-01T00:00:00Z"),
};

function summary(allocation: ReturnType<typeof allocateEmployeeMinutes>) {
	return allocation.status === "allocated"
		? [
				allocation.minutes,
				allocation.overlap.start.toString(),
				allocation.overlap.endExclusive.toString(),
			]
		: allocation;
}

describe("allocateEmployeeMinutes (#1997)", () => {
	it("credits an employee's work exactly as the shared rule does", () => {
		const allocation = allocateEmployeeMinutes(
			{
				startAt: instant("2026-04-02T08:00:00Z"),
				endAt: instant("2026-04-02T16:00:00Z"),
				storedMinutes: 450,
			},
			april,
			employee,
		);

		expect(summary(allocation)).toEqual([450, "2026-04-02T08:00:00Z", "2026-04-02T16:00:00Z"]);
	});

	it("leaves work inside a contractor stint out, even work the shared rule would block", () => {
		const allocation = allocateEmployeeMinutes(
			{
				startAt: instant("2026-04-01T08:00:00Z"),
				endAt: instant("2026-04-01T11:00:00Z"),
				storedMinutes: null,
			},
			april,
			converted,
		);

		expect(allocation).toEqual({ status: "outside" });
	});

	it("credits only the employee part of work across the conversion instant", () => {
		const allocation = allocateEmployeeMinutes(
			{
				startAt: instant("2026-04-01T10:00:00Z"),
				endAt: instant("2026-04-01T16:00:00Z"),
				storedMinutes: 360,
			},
			april,
			converted,
		);

		expect(summary(allocation)).toEqual([240, "2026-04-01T12:00:00Z", "2026-04-01T16:00:00Z"]);
	});

	it("blocks the employee part when stored minutes cannot be split there", () => {
		const allocation = allocateEmployeeMinutes(
			{
				startAt: instant("2026-04-01T10:00:00Z"),
				endAt: instant("2026-04-01T16:00:00Z"),
				storedMinutes: 300,
			},
			april,
			converted,
		);

		expect(allocation).toEqual({ status: "blocked", reason: "unresolved_interval" });
	});
});
