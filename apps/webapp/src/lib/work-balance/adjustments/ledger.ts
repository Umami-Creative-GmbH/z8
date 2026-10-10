import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { db } from "@/db";
import { balanceAdjustment } from "@/db/schema";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

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
 * Payouts only: the opening balance in effect is not a sum term but replaces
 * everything through its day (#997), so callers combine both through
 * `readWorkBalanceAdjustments`.
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

/** The employee's uncancelled opening balance; at most one is in effect (#997). */
export type OpeningBalanceInEffect = {
	id: string;
	/** Local date in the employee's effective timezone (`YYYY-MM-DD`). */
	day: string;
	/** Signed minutes: positive, negative or zero. */
	minutes: number;
};

export async function readOpeningBalanceInEffect(
	client: BalanceAdjustmentReadClient,
	input: { organizationId: string; employeeId: string },
): Promise<OpeningBalanceInEffect | null> {
	const [row] = await client
		.select({
			id: balanceAdjustment.id,
			day: balanceAdjustment.day,
			minutes: balanceAdjustment.minutes,
		})
		.from(balanceAdjustment)
		.where(
			and(
				eq(balanceAdjustment.organizationId, input.organizationId),
				eq(balanceAdjustment.employeeId, input.employeeId),
				eq(balanceAdjustment.kind, "opening_balance"),
				isNull(balanceAdjustment.cancelledAt),
			),
		)
		.limit(1);
	return row ?? null;
}

/** The employee's uncancelled overtime payouts, oldest day first. */
export async function listUncancelledPayouts(
	client: BalanceAdjustmentReadClient,
	input: { organizationId: string; employeeId: string },
): Promise<Array<{ id: string; day: string; minutes: number }>> {
	return client
		.select({
			id: balanceAdjustment.id,
			day: balanceAdjustment.day,
			minutes: balanceAdjustment.minutes,
		})
		.from(balanceAdjustment)
		.where(
			and(
				eq(balanceAdjustment.organizationId, input.organizationId),
				eq(balanceAdjustment.employeeId, input.employeeId),
				eq(balanceAdjustment.kind, "overtime_payout"),
				isNull(balanceAdjustment.cancelledAt),
			),
		)
		.orderBy(asc(balanceAdjustment.day), asc(balanceAdjustment.recordedAt));
}

/** The ISO date after `day` (`YYYY-MM-DD`). */
export function dayAfter(day: string): string {
	return parsePlainDate(day).add({ days: 1 }).toString();
}

/**
 * What the balance adjustments contribute to a work balance computed through
 * `throughDate` (ADR-0008):
 *
 * - `countFrom`: with an opening balance in effect, the day after it. Work and
 *   required time before it no longer count; the caller starts its
 *   calculation there (or later).
 * - `adjustmentMinutes`: the opening balance's minutes plus the uncancelled
 *   payouts dated after it, through `throughDate`.
 *
 * `openingBalanceDatedLater` decides an opening balance dated after
 * `throughDate`: `count` (the stored projection, which runs through yesterday
 * while an opening balance may be dated today) treats it as in effect;
 * `ignore` (a balance as of an earlier day) computes without it.
 */
export async function readWorkBalanceAdjustments(
	client: BalanceAdjustmentReadClient,
	input: {
		organizationId: string;
		employeeId: string;
		throughDate: string;
		openingBalanceDatedLater: "count" | "ignore";
	},
): Promise<{
	openingBalance: OpeningBalanceInEffect | null;
	countFrom: string | null;
	adjustmentMinutes: number;
}> {
	const scope = { organizationId: input.organizationId, employeeId: input.employeeId };
	const inEffect = await readOpeningBalanceInEffect(client, scope);
	const openingBalance =
		inEffect && (inEffect.day <= input.throughDate || input.openingBalanceDatedLater === "count")
			? inEffect
			: null;
	const countFrom = openingBalance ? dayAfter(openingBalance.day) : null;
	const payoutMinutes = await sumBalanceAdjustmentMinutes(client, {
		...scope,
		throughDate: input.throughDate,
		...(countFrom ? { fromDate: countFrom } : {}),
	});
	return {
		openingBalance,
		countFrom,
		adjustmentMinutes: (openingBalance?.minutes ?? 0) + payoutMinutes,
	};
}
