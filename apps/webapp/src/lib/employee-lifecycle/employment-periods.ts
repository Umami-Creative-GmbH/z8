import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employee } from "@/db/schema";
import { employeeDeparture, employeeEmploymentPeriod } from "@/db/schema/employee-lifecycle";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { EmploymentInterval } from "./employment-coverage";
import type { LifecycleTransaction } from "./types";

type CoverageDatabase = Pick<typeof rootDatabase, "select">;

/**
 * An effective departure ended this employee's employment and no rehire has
 * opened a new period. Membership or provisioning changes cannot reactivate
 * such an employee (migration 0073 enforces this on the projection).
 */
export async function hasEndedEmploymentWithoutRehire(
	database: Pick<typeof rootDatabase, "execute">,
	input: { organizationId: string; employeeId: string },
): Promise<boolean> {
	const result = await database.execute<{ ended: boolean }>(
		sql`SELECT employee_employment_ended_without_rehire(${input.organizationId}, ${input.employeeId}::uuid) AS ended`,
	);
	return result.rows[0]?.ended === true;
}

export class EmploymentPeriodError extends Error {
	constructor(readonly code: "employment_period_closed" | "terms_before_period_start") {
		super(code);
		this.name = "EmploymentPeriodError";
	}
}

type CurrentEmploymentPeriod = {
	id: string;
	status: "open" | "legacy_unknown";
	startedAt: Date | null;
	startProvenance: string;
};

/**
 * The employee's current employment period, or null once a departure ended it.
 * Employees created after migration 0071 are backfilled lazily. For legacy
 * compatibility, a period the migration could only classify as legacy_unknown
 * (the employee was inactive then) still counts while no departure ended the
 * employment: it is reopened in place, dates untouched, when the employee is
 * active again, and returned as-is otherwise.
 */
export async function resolveCurrentEmploymentPeriod(
	tx: LifecycleTransaction,
	input: { organizationId: string; employeeId: string },
): Promise<CurrentEmploymentPeriod | null> {
	await tx.execute(
		sql`SELECT employee_employment_period_backfill_legacy(${input.organizationId}, ${input.employeeId}::uuid)`,
	);
	const periodColumns = {
		id: employeeEmploymentPeriod.id,
		startedAt: employeeEmploymentPeriod.startedAt,
		startProvenance: employeeEmploymentPeriod.startProvenance,
	};
	const scope = and(
		eq(employeeEmploymentPeriod.organizationId, input.organizationId),
		eq(employeeEmploymentPeriod.employeeId, input.employeeId),
	);
	const [open] = await tx
		.select(periodColumns)
		.from(employeeEmploymentPeriod)
		.where(and(scope, eq(employeeEmploymentPeriod.status, "open")));
	if (open) return { ...open, status: "open" };
	if (await hasEndedEmploymentWithoutRehire(tx, input)) return null;

	const [legacy] = await tx
		.select(periodColumns)
		.from(employeeEmploymentPeriod)
		.where(
			and(
				scope,
				eq(employeeEmploymentPeriod.status, "legacy_unknown"),
				isNull(employeeEmploymentPeriod.endedAt),
			),
		)
		.orderBy(desc(employeeEmploymentPeriod.createdAt))
		.limit(1);
	if (!legacy) return null;

	const [target] = await tx
		.select({ isActive: employee.isActive })
		.from(employee)
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.id, input.employeeId)),
		);
	if (!target?.isActive) return { ...legacy, status: "legacy_unknown" };

	await tx
		.update(employeeEmploymentPeriod)
		.set({ status: "open" })
		.where(and(scope, eq(employeeEmploymentPeriod.id, legacy.id)));
	return { ...legacy, status: "open" };
}

/**
 * The employment period new or confirmed terms belong to. Terms never reopen
 * an ended period, and never start before a recorded (rehire) start, so a
 * timeline cannot bridge the employment gap.
 */
export async function resolveTermsEmploymentPeriod(
	tx: LifecycleTransaction,
	input: { organizationId: string; employeeId: string; validFrom: Date },
): Promise<string> {
	const period = await resolveCurrentEmploymentPeriod(tx, input);
	if (!period) throw new EmploymentPeriodError("employment_period_closed");
	if (
		period.startProvenance === "recorded" &&
		period.startedAt &&
		input.validFrom.getTime() < period.startedAt.getTime()
	) {
		throw new EmploymentPeriodError("terms_before_period_start");
	}
	return period.id;
}

/**
 * Employment coverage established by lifecycle evidence only: a recorded
 * period start (rehire) and an end set by an effective departure. Legacy
 * backfilled dates never narrow existing behavior, so an employee without such
 * evidence has no coverage (null).
 */
export async function loadEmploymentCoverage(
	database: CoverageDatabase,
	input: { organizationId: string; employeeId: string },
): Promise<EmploymentInterval[] | null> {
	const periods = await database
		.select({
			startedAt: employeeEmploymentPeriod.startedAt,
			startProvenance: employeeEmploymentPeriod.startProvenance,
			endedAt: employeeEmploymentPeriod.endedAt,
			departureId: employeeDeparture.id,
		})
		.from(employeeEmploymentPeriod)
		.leftJoin(
			employeeDeparture,
			and(
				eq(employeeDeparture.organizationId, employeeEmploymentPeriod.organizationId),
				eq(employeeDeparture.employmentPeriodId, employeeEmploymentPeriod.id),
				eq(employeeDeparture.status, "effective"),
			),
		)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				eq(employeeEmploymentPeriod.employeeId, input.employeeId),
			),
		);

	const coverage = periods.map((period) => ({
		startedAt:
			period.startProvenance === "recorded" && period.startedAt
				? instantFromDate(period.startedAt)
				: null,
		endedAt: period.departureId && period.endedAt ? instantFromDate(period.endedAt) : null,
	}));
	const hasLifecycleEvidence = coverage.some(
		(interval) => interval.startedAt !== null || interval.endedAt !== null,
	);
	return hasLifecycleEvidence ? coverage : null;
}
