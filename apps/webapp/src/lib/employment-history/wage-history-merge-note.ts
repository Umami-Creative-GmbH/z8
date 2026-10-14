import { and, eq, isNull, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employeeWageHistoryMergeNote } from "@/db/schema";

type Database = Pick<typeof appDb, "select" | "update">;

/** The one-time note that an employee's wage history was merged from the old rate history. */
export type WageHistoryMergeNote = {
	/** The organization-local date of the merge, `YYYY-MM-DD`. */
	mergedOn: string;
	/** How many of the employee's rate changes the merge adjusted. */
	adjustedCount: number;
};

/**
 * The employee's wage history merge note (#1176), read for one organization; null when the
 * merge didn't affect the employee or an org admin dismissed the note.
 */
export async function loadWageHistoryMergeNote(
	database: Pick<Database, "select">,
	input: { organizationId: string; employeeId: string },
): Promise<WageHistoryMergeNote | null> {
	const [note] = await database
		.select({
			mergedOn: employeeWageHistoryMergeNote.mergedOn,
			adjustedCount: employeeWageHistoryMergeNote.adjustedCount,
		})
		.from(employeeWageHistoryMergeNote)
		.where(
			and(
				eq(employeeWageHistoryMergeNote.organizationId, input.organizationId),
				eq(employeeWageHistoryMergeNote.employeeId, input.employeeId),
				isNull(employeeWageHistoryMergeNote.dismissedAt),
			),
		)
		.limit(1);
	return note ?? null;
}

/**
 * Dismisses the employee's note for every org admin, for good. A later dismissal keeps the
 * first one's time and admin.
 */
export async function dismissWageHistoryMergeNote(
	database: Pick<Database, "update">,
	input: { organizationId: string; employeeId: string; actorUserId: string },
): Promise<void> {
	await database
		.update(employeeWageHistoryMergeNote)
		.set({ dismissedAt: sql`now()`, dismissedBy: input.actorUserId })
		.where(
			and(
				eq(employeeWageHistoryMergeNote.organizationId, input.organizationId),
				eq(employeeWageHistoryMergeNote.employeeId, input.employeeId),
				isNull(employeeWageHistoryMergeNote.dismissedAt),
			),
		);
}
