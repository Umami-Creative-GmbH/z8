import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { user } from "@/db/auth-schema";
import { employee, vacationAdjustment } from "@/db/schema";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";

/** An employee's vacation adjustments for a year, split by kind (#1106). */
export type VacationAdjustmentSums = {
	/** Admin and manager adjustments. */
	manual: number;
	/** The accrual job's shares: an accrual policy's allowance to date. */
	accrual: number;
};

/**
 * The sums of each employee's vacation adjustments (`vacation_adjustment.days`) for a year, by
 * kind. Only employees of the organization get an entry; one without adjustments gets zeros.
 */
export async function loadVacationAdjustmentSums(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeIds: readonly string[]; year: number },
): Promise<Map<string, VacationAdjustmentSums>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();

	const rows = await database
		.select({
			employeeId: employee.id,
			manual: sql<string>`COALESCE(SUM(${vacationAdjustment.days}) FILTER (WHERE ${vacationAdjustment.kind} = 'manual'), 0)`,
			accrual: sql<string>`COALESCE(SUM(${vacationAdjustment.days}) FILTER (WHERE ${vacationAdjustment.kind} = 'accrual'), 0)`,
		})
		.from(employee)
		.leftJoin(
			vacationAdjustment,
			and(eq(vacationAdjustment.employeeId, employee.id), eq(vacationAdjustment.year, input.year)),
		)
		.where(
			and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)),
		)
		.groupBy(employee.id);

	return new Map(
		rows.map((row) => [
			row.employeeId,
			{ manual: Number.parseFloat(row.manual), accrual: Number.parseFloat(row.accrual) },
		]),
	);
}

/**
 * The sum of each employee's vacation adjustments for a year, manual and accrual alike: the one
 * lookup every vacation balance reader adds to the allowance (#1105). Only employees of the
 * organization get an entry; one without adjustments gets 0.
 */
export async function loadVacationAdjustmentTotals(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeIds: readonly string[]; year: number },
): Promise<Map<string, number>> {
	const sums = await loadVacationAdjustmentSums(database, input);
	return new Map(
		[...sums].map(([employeeId, { manual, accrual }]) => [employeeId, manual + accrual]),
	);
}

/** One employee's adjustment total for a year; 0 for an employee outside the organization. */
export async function loadVacationAdjustmentTotal(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeId: string; year: number },
): Promise<number> {
	const totals = await loadVacationAdjustmentTotals(database, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		year: input.year,
	});
	return totals.get(input.employeeId) ?? 0;
}

export type ManualVacationAdjustment = {
	id: string;
	days: number;
	reason: string;
	/** The adjusting employee's name; null when the employee or their user is gone. */
	adjustedByName: string | null;
	createdAt: Date;
};

/**
 * One employee's manual adjustments for a year, newest first: the adjustment history on the
 * admin vacation page (#1106). Accrual rows are left out. Empty for an employee outside the
 * organization.
 */
export async function loadManualVacationAdjustments(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeId: string; year: number },
): Promise<ManualVacationAdjustment[]> {
	const adjuster = alias(employee, "adjuster");
	const adjusterUser = alias(user, "adjuster_user");
	const rows = await database
		.select({
			id: vacationAdjustment.id,
			days: vacationAdjustment.days,
			reason: vacationAdjustment.reason,
			adjustedByName: adjusterUser.name,
			createdAt: vacationAdjustment.createdAt,
		})
		.from(vacationAdjustment)
		.innerJoin(employee, eq(employee.id, vacationAdjustment.employeeId))
		.leftJoin(adjuster, eq(adjuster.id, vacationAdjustment.adjustedBy))
		.leftJoin(adjusterUser, eq(adjusterUser.id, adjuster.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(vacationAdjustment.employeeId, input.employeeId),
				eq(vacationAdjustment.year, input.year),
				eq(vacationAdjustment.kind, "manual"),
			),
		)
		.orderBy(desc(vacationAdjustment.createdAt), desc(vacationAdjustment.id));

	return rows.map((row) => ({
		id: row.id,
		days: Number.parseFloat(row.days),
		reason: row.reason,
		adjustedByName: row.adjustedByName ?? null,
		createdAt: row.createdAt,
	}));
}
