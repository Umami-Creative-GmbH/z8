import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
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
