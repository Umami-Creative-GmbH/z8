import { Temporal } from "temporal-polyfill";
import { type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";

/**
 * Historical project eligibility of expenses (#605). An employee may attribute
 * an expense to a project they were authorized to use on its expense date:
 *
 * - an interval of captured assignment history to them, or to a team while
 *   they were in it, overlaps that calendar day; or
 * - an authorized, evidenced attribution exception covers that date.
 *
 * Current assignments never prove a past date: history exists only from its
 * capture (migration 0119) onwards. Project status is irrelevant, so a proven
 * assignment to a project closed later stays eligible. The picker and every
 * server validation use this one rule.
 *
 * Expense dates are calendar days without a zone; the caller names the zone
 * whose day they are (the trip's zone, or the organization's for standalone
 * expenses). A window of several days (a trip) is eligible when any day is.
 */

export type ProjectEligibilityBasis = "employee_assignment" | "team_assignment" | "exception";

export type ProjectEligibility =
	| { basis: "employee_assignment" | "team_assignment" }
	| { basis: "exception"; exceptionId: string };

/** Calendar days `from`..`to` (inclusive, YYYY-MM-DD) in `timeZone`. */
export interface EligibilityWindow {
	from: string;
	to: string;
	timeZone: string;
}

export interface EligibilityAssignment {
	projectId: string;
	assignmentType: "employee" | "team";
	employeeId: string | null;
	teamId: string | null;
	effectiveFrom: Instant;
	effectiveTo: Instant | null;
}

export interface EligibilityTeamMembership {
	teamId: string;
	effectiveFrom: Instant;
	effectiveTo: Instant | null;
}

/** Exceptions of the employee; the first one covering the window is used. */
export interface EligibilityException {
	id: string;
	projectId: string;
	validFrom: string;
	validTo: string;
}

type Interval = { start: bigint; end: bigint | null };

/** The window's half-open instant range `[start of from, start of to + 1)`. */
export function eligibilityWindowRange(window: EligibilityWindow): {
	start: Instant;
	end: Instant;
} {
	const from = parsePlainDate(window.from);
	const to = parsePlainDate(window.to);
	if (Temporal.PlainDate.compare(to, from) < 0)
		throw new RangeError("Window ends before it starts");
	return {
		start: from.toZonedDateTime({ timeZone: window.timeZone }).toInstant(),
		end: to.add({ days: 1 }).toZonedDateTime({ timeZone: window.timeZone }).toInstant(),
	};
}

function interval(start: Instant, end: Instant | null): Interval {
	return { start: start.epochNanoseconds, end: end ? end.epochNanoseconds : null };
}

function intersect(left: Interval, right: Interval): Interval | null {
	const start = left.start > right.start ? left.start : right.start;
	const end =
		left.end === null
			? right.end
			: right.end === null
				? left.end
				: left.end < right.end
					? left.end
					: right.end;
	// Half-open: an empty (or zero-length) interval proves nothing.
	return end === null || start < end ? { start, end } : null;
}

export function resolveProjectEligibility(input: {
	employeeId: string;
	window: EligibilityWindow;
	assignments: readonly EligibilityAssignment[];
	teamMemberships: readonly EligibilityTeamMembership[];
	exceptions: readonly EligibilityException[];
}): Map<string, ProjectEligibility> {
	const range = eligibilityWindowRange(input.window);
	const window = interval(range.start, range.end);
	const eligible = new Map<string, ProjectEligibility>();
	const team = new Set<string>();

	for (const assignment of input.assignments) {
		const assigned = intersect(window, interval(assignment.effectiveFrom, assignment.effectiveTo));
		if (!assigned) continue;
		if (assignment.assignmentType === "employee") {
			if (assignment.employeeId === input.employeeId) {
				eligible.set(assignment.projectId, { basis: "employee_assignment" });
			}
			continue;
		}
		const covered = input.teamMemberships.some(
			(membership) =>
				membership.teamId === assignment.teamId &&
				intersect(assigned, interval(membership.effectiveFrom, membership.effectiveTo)) !== null,
		);
		if (covered) team.add(assignment.projectId);
	}
	for (const projectId of team) {
		if (!eligible.has(projectId)) eligible.set(projectId, { basis: "team_assignment" });
	}

	const from = parsePlainDate(input.window.from);
	const to = parsePlainDate(input.window.to);
	for (const exception of input.exceptions) {
		if (eligible.has(exception.projectId)) continue;
		const covers =
			Temporal.PlainDate.compare(parsePlainDate(exception.validFrom), to) <= 0 &&
			Temporal.PlainDate.compare(parsePlainDate(exception.validTo), from) >= 0;
		if (covers)
			eligible.set(exception.projectId, { basis: "exception", exceptionId: exception.id });
	}
	return eligible;
}
