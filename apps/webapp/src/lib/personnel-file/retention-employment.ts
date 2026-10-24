import { and, eq, exists, inArray, notExists, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { db as appDb } from "@/db";
import { employee } from "@/db/schema";
import { employeeEmploymentPeriod } from "@/db/schema/employee-lifecycle";
import { compareInstants, instantFromDate } from "@/lib/datetime/temporal-core";
import type { EmploymentPeriodForRetention } from "./retention";

/**
 * The employment the retention rules read (#870), shared by the documents'
 * due list and the document requests' deletion. A departure closes the
 * employment period at its cutoff. A deactivation without a departure leaves
 * the period open but ends the employment too (#1440, Organization ADR 0006):
 * while the employee stays deactivated, their open period counts as ended at
 * `employee.deactivated_at`. Reactivation clears that instant, which stops the
 * clock again; a deactivation whose instant was never recorded (before
 * migration 0283) leaves the period open, so the start stays unknown.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/** The employment periods of each employee, as the retention rules read them. */
export async function loadRetentionEmployment(
	database: Reader,
	input: { organizationId: string; employeeIds: readonly string[] },
): Promise<Map<string, EmploymentPeriodForRetention[]>> {
	const byEmployee = new Map<string, EmploymentPeriodForRetention[]>();
	if (input.employeeIds.length === 0) return byEmployee;
	const rows = await database
		.select({
			employeeId: employeeEmploymentPeriod.employeeId,
			status: employeeEmploymentPeriod.status,
			startedAt: employeeEmploymentPeriod.startedAt,
			endedAt: employeeEmploymentPeriod.endedAt,
			deactivatedAt: employee.deactivatedAt,
		})
		.from(employeeEmploymentPeriod)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeEmploymentPeriod.employeeId),
				eq(employee.organizationId, employeeEmploymentPeriod.organizationId),
			),
		)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				inArray(employeeEmploymentPeriod.employeeId, [...input.employeeIds]),
			),
		);
	for (const row of rows) {
		const list = byEmployee.get(row.employeeId) ?? [];
		// Only a deactivation during the open period ends it; an older instant
		// belongs to an earlier employment.
		const deactivatedAt = row.deactivatedAt ? instantFromDate(row.deactivatedAt) : null;
		const endedByDeactivation =
			row.status === "open" &&
			deactivatedAt !== null &&
			(row.startedAt === null ||
				compareInstants(deactivatedAt, instantFromDate(row.startedAt)) >= 0);
		list.push(
			endedByDeactivation && deactivatedAt
				? { status: "closed", endedAt: deactivatedAt }
				: { status: row.status, endedAt: row.endedAt ? instantFromDate(row.endedAt) : null },
		);
		byEmployee.set(row.employeeId, list);
	}
	return byEmployee;
}

/**
 * Narrowing only, for queries over rows of an employee (`employeeId`): the
 * employment may have ended, so a retention start may exist. False while an
 * open period runs and the employee was not deactivated with a recorded
 * instant; `loadRetentionEmployment` decides.
 */
export function employmentMayHaveEnded(organizationId: string, employeeId: AnyPgColumn): SQL {
	const openPeriod = sql`(select 1 from ${employeeEmploymentPeriod}
		where ${employeeEmploymentPeriod.organizationId} = ${organizationId}
			and ${employeeEmploymentPeriod.employeeId} = ${employeeId}
			and ${employeeEmploymentPeriod.status} = 'open')`;
	const deactivated = sql`(select 1 from ${employee}
		where ${employee.organizationId} = ${organizationId}
			and ${employee.id} = ${employeeId}
			and ${employee.deactivatedAt} is not null)`;
	return or(notExists(openPeriod), exists(deactivated)) as SQL;
}
