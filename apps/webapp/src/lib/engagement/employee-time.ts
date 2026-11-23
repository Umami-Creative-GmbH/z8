import type { EmploymentPeriodSnapshot } from "@/lib/contracts/resolve-contract";
import type { InstantRange } from "@/lib/datetime/temporal-boundaries";
import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import type { EngagementKind } from "./engagement-kind";

/**
 * A person's stints as the payroll, earnings and statutory domains read them (#1997): employee
 * time is the only time they ever see. `employeeEngagementKind` is `employee.engagement_kind`,
 * which decides only for a person without any recorded stint.
 */
export interface EngagementStints {
	readonly periods: readonly EmploymentPeriodSnapshot[];
	readonly employeeEngagementKind: EngagementKind;
}

/** A person without any recorded stint who is an employee: all time is employee time. */
export const PLAIN_EMPLOYEE_STINTS: EngagementStints = {
	periods: [],
	employeeEngagementKind: "employee",
};

/**
 * The parts of `window` that are employee time (#1997), as half-open instant ranges in order.
 * Exact to the instant, like contractor pricing (#1998), so a conversion day is split where one
 * stint ends and the next begins and the two domains never share a moment:
 *
 * - inside a stint, the stint's kind; where a contractor stint overlaps another stint, contractor;
 * - between stints, the kind of the stint that ended last before (as `engagementKindOnDay` decides
 *   a day outside every stint); before the first stint, the kind of the stint that starts first;
 * - a stint whose start was not recorded is open towards the past, as in the contract resolver;
 * - without any recorded stint, all of the window or none of it by `employee.engagement_kind`.
 *
 * An empty window (one instant) is returned as is when that instant is employee time.
 */
export function employeeTimeWithin(stints: EngagementStints, window: InstantRange): InstantRange[] {
	if (compareInstants(window.start, window.endExclusive) >= 0) {
		return kindAt(stints, window.start) === "employee" ? [window] : [];
	}

	const boundaries = [window.start];
	for (const period of stints.periods) {
		for (const boundary of [effectiveStart(period), period.endedAt]) {
			if (
				boundary &&
				compareInstants(boundary, window.start) > 0 &&
				compareInstants(boundary, window.endExclusive) < 0
			) {
				boundaries.push(boundary);
			}
		}
	}
	boundaries.sort(compareInstants);
	boundaries.push(window.endExclusive);

	const ranges: InstantRange[] = [];
	for (let index = 0; index < boundaries.length - 1; index++) {
		const start = boundaries[index] as Instant;
		const endExclusive = boundaries[index + 1] as Instant;
		if (compareInstants(start, endExclusive) === 0) continue;
		if (kindAt(stints, start) !== "employee") continue;
		const previous = ranges.at(-1);
		if (previous && compareInstants(previous.endExclusive, start) === 0) {
			ranges[ranges.length - 1] = { start: previous.start, endExclusive };
		} else {
			ranges.push({ start, endExclusive });
		}
	}
	return ranges;
}

/** Whether any part of `window` (or its one instant) is employee time. */
export function hasEmployeeTimeWithin(stints: EngagementStints, window: InstantRange): boolean {
	return employeeTimeWithin(stints, window).length > 0;
}

/** The engagement kind at one instant, by the rules of `employeeTimeWithin`. */
function kindAt(stints: EngagementStints, instant: Instant): EngagementKind {
	const { periods } = stints;
	if (periods.length === 0) return stints.employeeEngagementKind;

	const containing = periods.filter((period) => {
		const start = effectiveStart(period);
		return (
			(start === null || compareInstants(start, instant) <= 0) &&
			(period.endedAt === null || compareInstants(instant, period.endedAt) < 0)
		);
	});
	if (containing.length > 0) return combined(containing);

	let preceding: EmploymentPeriodSnapshot[] = [];
	let following: EmploymentPeriodSnapshot[] = [];
	for (const period of periods) {
		if (period.endedAt !== null && compareInstants(period.endedAt, instant) <= 0) {
			const order = preceding[0]?.endedAt
				? compareInstants(period.endedAt, preceding[0].endedAt)
				: 1;
			if (order > 0) preceding = [period];
			else if (order === 0) preceding.push(period);
			continue;
		}
		const start = effectiveStart(period);
		if (start === null) continue;
		const leading = following[0] ? effectiveStart(following[0]) : null;
		const order = leading ? compareInstants(start, leading) : -1;
		if (order < 0) following = [period];
		else if (order === 0) following.push(period);
	}
	const nearest = preceding.length > 0 ? preceding : following;
	return nearest.length > 0 ? combined(nearest) : stints.employeeEngagementKind;
}

/** Contractor wins whenever stints of both kinds meet: contractor time never reaches payroll. */
function combined(periods: readonly EmploymentPeriodSnapshot[]): EngagementKind {
	return periods.some((period) => period.engagementKind === "contractor")
		? "contractor"
		: "employee";
}

function effectiveStart(period: EmploymentPeriodSnapshot): Instant | null {
	return period.startProvenance === "recorded" ? period.startedAt : null;
}
