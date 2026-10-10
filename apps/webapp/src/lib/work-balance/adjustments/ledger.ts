import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { db } from "@/db";
import { balanceAdjustment } from "@/db/schema";

/**
 * Reads of the balance adjustment ledger that the work-balance projection
 * adds in (#993, ADR-0008). Kept free of the projection itself, so the
 * projection can import it. Every query is filtered by `organizationId`.
 */
export type BalanceAdjustmentReadClient = Pick<typeof db, "select">;

/**
 * The signed minutes of the employee's uncancelled overtime payouts whose day
 * is on or before `throughDate` (and on or after `fromDate`, when given): each
 * counts from the end of its day.
 *
 * Opening balances are not counted yet: their replace rule (the projection
 * starts the day after them) arrives with #997, which extends this sum.
 */
export async function sumBalanceAdjustmentMinutes(
	client: BalanceAdjustmentReadClient,
	input: {
		organizationId: string;
		employeeId: string;
		throughDate: string;
		fromDate?: string;
	},
): Promise<number> {
	const [row] = await client
		.select({ minutes: sql<number>`coalesce(sum(${balanceAdjustment.minutes}), 0)` })
		.from(balanceAdjustment)
		.where(
			and(
				eq(balanceAdjustment.organizationId, input.organizationId),
				eq(balanceAdjustment.employeeId, input.employeeId),
				eq(balanceAdjustment.kind, "overtime_payout"),
				isNull(balanceAdjustment.cancelledAt),
				lte(balanceAdjustment.day, input.throughDate),
				...(input.fromDate ? [gte(balanceAdjustment.day, input.fromDate)] : []),
			),
		);
	return Number(row?.minutes ?? 0);
}

/**
 * The uncancelled overtime payouts of the given employees whose day lies from
 * `fromDate` through `throughDate` (local dates, inclusive), by day: what the
 * DATEV, Lexware and Sage payroll files carry (#1001). Opening balances are
 * never exported. Minutes are signed as stored, so a payout is negative.
 */
export async function listOvertimePayouts(
	client: BalanceAdjustmentReadClient,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		fromDate: string;
		throughDate: string;
	},
): Promise<Array<{ id: string; employeeId: string; day: string; minutes: number }>> {
	if (input.employeeIds.length === 0) return [];
	return client
		.select({
			id: balanceAdjustment.id,
			employeeId: balanceAdjustment.employeeId,
			day: balanceAdjustment.day,
			minutes: balanceAdjustment.minutes,
		})
		.from(balanceAdjustment)
		.where(
			and(
				eq(balanceAdjustment.organizationId, input.organizationId),
				inArray(balanceAdjustment.employeeId, [...input.employeeIds]),
				eq(balanceAdjustment.kind, "overtime_payout"),
				isNull(balanceAdjustment.cancelledAt),
				gte(balanceAdjustment.day, input.fromDate),
				lte(balanceAdjustment.day, input.throughDate),
			),
		)
		.orderBy(asc(balanceAdjustment.day), asc(balanceAdjustment.recordedAt));
}