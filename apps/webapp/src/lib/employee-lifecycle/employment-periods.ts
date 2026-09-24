import { and, eq, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employeeDeparture, employeeEmploymentPeriod } from "@/db/schema/employee-lifecycle";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { EmploymentInterval } from "./employment-coverage";
import type { LifecycleTransaction } from "./types";

type CoverageDatabase = Pick<typeof rootDatabase, "select">;

/**
 * An effective departure ended this employee's employment and no rehire has
 * opened a new period. Membership or provisioning changes cannot reactivate
 * such an employee (migration 0071 enforces this on the projection).
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

/**
 * The employment period new or confirmed terms belong to: the employee's open
 * period, backfilled lazily for employees created after migration 0069. Terms
 * never reopen an ended period, and never start before a recorded (rehire)
 * start, so a timeline cannot bridge the employment gap.
 */
export async function resolveTermsEmploymentPeriod(
	tx: LifecycleTransaction,
	input: { organizationId: string; employeeId: string; validFrom: Date },
): Promise<string> {
	await tx.execute(
		sql`SELECT employee_employment_period_backfill_legacy(${input.organizationId}, ${input.employeeId}::uuid)`,
	);
	const [period] = await tx
		.select({
			id: employeeEmploymentPeriod.id,
			startedAt: employeeEmploymentPeriod.startedAt,
			startProvenance: employeeEmploymentPeriod.startProvenance,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				eq(employeeEmploymentPeriod.employeeId, input.employeeId),
				eq(employeeEmploymentPeriod.status, "open"),
			),
		);
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
