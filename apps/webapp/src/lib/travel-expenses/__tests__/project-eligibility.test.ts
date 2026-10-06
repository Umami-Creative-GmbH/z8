import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	type EligibilityAssignment,
	type EligibilityException,
	type EligibilityTeamMembership,
	resolveProjectEligibility,
} from "../project-eligibility";

const at = (value: string) => Temporal.Instant.from(value);
const EMPLOYEE = "employee-1";
const BERLIN = "Europe/Berlin";

function direct(projectId: string, from: string, to: string | null = null): EligibilityAssignment {
	return {
		projectId,
		assignmentType: "employee",
		employeeId: EMPLOYEE,
		teamId: null,
		effectiveFrom: at(from),
		effectiveTo: to ? at(to) : null,
	};
}

function teamAssignment(
	projectId: string,
	teamId: string,
	from: string,
	to: string | null = null,
): EligibilityAssignment {
	return {
		projectId,
		assignmentType: "team",
		employeeId: null,
		teamId,
		effectiveFrom: at(from),
		effectiveTo: to ? at(to) : null,
	};
}

function membership(teamId: string, from: string, to: string | null = null) {
	return {
		teamId,
		effectiveFrom: at(from),
		effectiveTo: to ? at(to) : null,
	} satisfies EligibilityTeamMembership;
}

function resolve(input: {
	from: string;
	to?: string;
	assignments?: EligibilityAssignment[];
	teamMemberships?: EligibilityTeamMembership[];
	exceptions?: EligibilityException[];
}) {
	return Object.fromEntries(
		resolveProjectEligibility({
			employeeId: EMPLOYEE,
			window: { from: input.from, to: input.to ?? input.from, timeZone: BERLIN },
			assignments: input.assignments ?? [],
			teamMemberships: input.teamMemberships ?? [],
			exceptions: input.exceptions ?? [],
		}),
	);
}

describe("resolveProjectEligibility", () => {
	it("proves a project assigned to the employee during the expense date", () => {
		expect(
			resolve({ from: "2026-10-05", assignments: [direct("p1", "2026-09-01T08:00:00Z")] }),
		).toEqual({ p1: { basis: "employee_assignment" } });
	});

	it("keeps an assignment that was open on the expense date though it ended later", () => {
		expect(
			resolve({
				from: "2026-10-05",
				assignments: [direct("p1", "2026-09-01T08:00:00Z", "2026-10-20T08:00:00Z")],
			}),
		).toEqual({ p1: { basis: "employee_assignment" } });
	});

	it("does not prove dates before the assignment began or after it ended", () => {
		const assignments = [direct("p1", "2026-10-10T08:00:00Z", "2026-10-20T08:00:00Z")];
		expect(resolve({ from: "2026-10-09", assignments })).toEqual({});
		expect(resolve({ from: "2026-10-21", assignments })).toEqual({});
	});

	it("reads the expense date as a calendar day in the given zone", () => {
		// 23:30 UTC on Oct 4 is already Oct 5 in Berlin.
		const assignments = [direct("p1", "2026-09-01T08:00:00Z", "2026-10-04T23:30:00Z")];
		expect(resolve({ from: "2026-10-05", assignments })).toEqual({
			p1: { basis: "employee_assignment" },
		});
		// Starting 22:30 UTC on Oct 5 is Oct 6 in Berlin: Oct 5 is not covered.
		expect(
			resolve({ from: "2026-10-05", assignments: [direct("p1", "2026-10-05T22:30:00Z")] }),
		).toEqual({});
	});

	it("ignores an interval that was opened and closed at the same instant", () => {
		expect(
			resolve({
				from: "2026-10-05",
				assignments: [direct("p1", "2026-10-05T10:00:00Z", "2026-10-05T10:00:00Z")],
			}),
		).toEqual({});
	});

	it("proves a team project only while the employee was in that team", () => {
		const assignments = [teamAssignment("p1", "team-a", "2026-09-01T08:00:00Z")];
		expect(
			resolve({
				from: "2026-10-05",
				assignments,
				teamMemberships: [membership("team-a", "2026-09-15T08:00:00Z")],
			}),
		).toEqual({ p1: { basis: "team_assignment" } });
		expect(
			resolve({
				from: "2026-10-05",
				assignments,
				teamMemberships: [membership("team-b", "2026-09-15T08:00:00Z")],
			}),
		).toEqual({});
	});

	it("requires the team membership and the team assignment to overlap each other", () => {
		expect(
			resolve({
				from: "2026-10-05",
				assignments: [teamAssignment("p1", "team-a", "2026-10-05T12:00:00Z")],
				teamMemberships: [
					membership("team-a", "2026-10-05T06:00:00Z", "2026-10-05T08:00:00Z"),
				],
			}),
		).toEqual({});
	});

	it("never proves anything from another employee's assignment", () => {
		expect(
			resolve({
				from: "2026-10-05",
				assignments: [{ ...direct("p1", "2026-09-01T08:00:00Z"), employeeId: "employee-2" }],
			}),
		).toEqual({});
	});

	it("accepts an authorized exception covering the expense date", () => {
		const exceptions = [
			{ id: "x1", projectId: "p2", validFrom: "2025-01-01", validTo: "2025-12-31" },
		];
		expect(resolve({ from: "2025-06-30", exceptions })).toEqual({
			p2: { basis: "exception", exceptionId: "x1" },
		});
		expect(resolve({ from: "2026-01-01", exceptions })).toEqual({});
	});

	it("prefers captured history over an exception for the same project", () => {
		expect(
			resolve({
				from: "2026-10-05",
				assignments: [direct("p1", "2026-09-01T08:00:00Z")],
				exceptions: [{ id: "x1", projectId: "p1", validFrom: "2026-01-01", validTo: "2026-12-31" }],
			}),
		).toEqual({ p1: { basis: "employee_assignment" } });
	});

	it("proves a date range when any of its days is covered", () => {
		expect(
			resolve({
				from: "2026-10-01",
				to: "2026-10-05",
				assignments: [direct("p1", "2026-10-04T08:00:00Z")],
				exceptions: [{ id: "x1", projectId: "p2", validFrom: "2026-09-01", validTo: "2026-10-01" }],
			}),
		).toEqual({
			p1: { basis: "employee_assignment" },
			p2: { basis: "exception", exceptionId: "x1" },
		});
	});
});
