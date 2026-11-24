import type { InstantRange } from "@/lib/datetime/temporal-boundaries";
import { type EngagementStints, employeeTimeWithin } from "@/lib/engagement/employee-time";
import {
	allocateProtectedMinutes,
	type ProtectedMinuteAllocation,
	type ProtectedWorkSegment,
} from "./protected-minutes";

/**
 * The shared payroll credit rule (`allocateProtectedMinutes`) applied only within the employee
 * time of the payroll window (#1997). External Contractor time is never credited, blocked or
 * reported: work entirely inside a contractor stint is `outside`, and work across a conversion
 * instant is split there with the same cumulative allocation as at a window edge, so the employee
 * part plus the contractor part always add up to the stored minutes. The overlap spans the
 * credited employee parts (one part in practice: a stint does not begin and end inside one piece
 * of work).
 */
export function allocateEmployeeMinutes(
	segment: ProtectedWorkSegment,
	payrollWindow: InstantRange,
	stints: EngagementStints,
): ProtectedMinuteAllocation {
	let minutes = 0;
	let overlap: InstantRange | null = null;
	for (const window of employeeTimeWithin(stints, payrollWindow)) {
		const allocation = allocateProtectedMinutes(segment, window);
		if (allocation.status === "blocked") return allocation;
		if (allocation.status === "outside") continue;
		minutes += allocation.minutes;
		overlap = overlap
			? { start: overlap.start, endExclusive: allocation.overlap.endExclusive }
			: allocation.overlap;
	}
	return overlap ? { status: "allocated", minutes, overlap } : { status: "outside" };
}
