import type { InstantRange } from "@/lib/datetime/temporal-boundaries";
import { compareInstants, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { allocateEmployeeMinutes } from "@/lib/payroll-allocation/employee-minutes";
import { employeeTimeWithin } from "./employee-time";
import { type EmployeeTime, loadEmployeeTime } from "./engagement-stints";

/**
 * Payroll scope (#1997): who and what an employee payroll read of a period covers. Payroll covers
 * only people with employee time in the period, and of them only their employee time: an External
 * Contractor never appears, and a converted person only with what they did as an employee.
 *
 * Every payroll surface (exports and their baselines and comparisons, the workspace's period,
 * day and PDF reads, carried days, readiness) resolves its people through `loadPayrollScope` and
 * reads records through the scope, so the next surface cannot forget a contractor stint.
 */
export interface PayrollScope {
	/** The candidates with employee time on any day of the period, in candidate order. */
	readonly employeeIds: readonly string[];
	/** Each candidate's employee time; anyone else reads as a plain employee. */
	readonly employeeTime: EmployeeTime;
	/** Whether the employee is in the scope. */
	includes(employeeId: string): boolean;
	/**
	 * Whether an employee-local day carries payroll for the employee: whether any of it is employee
	 * time. A conversion day is a payroll day for the employee part of it.
	 */
	isPayrollDay(employeeId: string, date: string): boolean;
	/**
	 * A work or break record as payroll shows it: the record itself when all of it is employee
	 * time; the part from its first to its last employee instant, with the minutes the payroll
	 * credit rule gives that part, when only some of it is; null when none of it is. A running
	 * record belongs to the stint it started in.
	 */
	clipRecord<T extends PayrollScopeRecord>(employeeId: string, record: T): T | null;
	/**
	 * The departure clock repairs that block payroll: those whose timer stopped in employee time
	 * (or at no known instant). A repair of a timer that ran in a contractor stint does not.
	 */
	blockingClockRepairs<T extends { employeeId: string; affectedEndAt: Date | null }>(
		repairs: readonly T[],
	): T[];
}

/** A stored work or break interval; `durationMinutes` is the recorded minutes of all of it. */
export interface PayrollScopeRecord {
	startAt: Instant;
	endAt: Instant | null;
	durationMinutes: number | null;
}

/** The payroll scope of `candidates` for `startDate`..`endDate` (inclusive employee-local days). */
export function payrollScope(
	employeeTime: EmployeeTime,
	candidates: readonly string[],
	period: { startDate: string; endDate: string },
): PayrollScope {
	const employeeIds = [...new Set(candidates)].filter((employeeId) =>
		employeeTime.hasEmployeeTimeOn(employeeId, period.startDate, period.endDate),
	);
	const included = new Set(employeeIds);
	return {
		employeeIds,
		employeeTime,
		includes: (employeeId) => included.has(employeeId),
		isPayrollDay: (employeeId, date) => employeeTime.hasEmployeeTimeOn(employeeId, date, date),
		clipRecord: (employeeId, record) => clipToEmployeeTime(employeeTime, employeeId, record),
		blockingClockRepairs: (repairs) =>
			repairs.filter(
				(repair) =>
					repair.affectedEndAt === null ||
					endsInEmployeeTime(
						employeeTime,
						repair.employeeId,
						instantFromDate(repair.affectedEndAt),
					),
			),
	};
}

/**
 * Loads the payroll scope of `candidates` (already scoped by the reader's payroll access) for the
 * period. One query after another: `db` may be a transaction on one connection.
 */
export async function loadPayrollScope(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	candidates: readonly string[],
	period: { startDate: string; endDate: string },
): Promise<PayrollScope> {
	return payrollScope(await loadEmployeeTime(db, organizationId, candidates), candidates, period);
}

/** Whether the moment just before `at` is employee time: a timer stopped at `at` ran in it. */
function endsInEmployeeTime(employeeTime: EmployeeTime, employeeId: string, at: Instant) {
	return (
		employeeTime.within(employeeId, { start: at.subtract({ nanoseconds: 1 }), endExclusive: at })
			.length > 0
	);
}

function clipToEmployeeTime<T extends PayrollScopeRecord>(
	employeeTime: EmployeeTime,
	employeeId: string,
	record: T,
): T | null {
	const stints = employeeTime.stintsOf(employeeId);
	const { startAt, endAt } = record;
	if (endAt === null || compareInstants(endAt, startAt) <= 0) {
		return employeeTimeWithin(stints, { start: startAt, endExclusive: startAt }).length > 0
			? record
			: null;
	}
	const whole: InstantRange = { start: startAt, endExclusive: endAt };
	const parts = employeeTimeWithin(stints, whole);
	const first = parts[0];
	const last = parts.at(-1);
	if (!first || !last) return null;
	if (
		compareInstants(first.start, startAt) === 0 &&
		compareInstants(last.endExclusive, endAt) === 0 &&
		parts.length === 1
	) {
		return record;
	}
	const allocation = allocateEmployeeMinutes(
		{ startAt, endAt, storedMinutes: record.durationMinutes },
		whole,
		stints,
	);
	const elapsedMinutes = parts.reduce(
		(sum, part) => sum + Math.floor(part.start.until(part.endExclusive).total({ unit: "minutes" })),
		0,
	);
	return {
		...record,
		startAt: first.start,
		endAt: last.endExclusive,
		durationMinutes: allocation.status === "allocated" ? allocation.minutes : elapsedMinutes,
	};
}
