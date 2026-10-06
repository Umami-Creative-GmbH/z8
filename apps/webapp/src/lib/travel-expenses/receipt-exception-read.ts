import { eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseSettings } from "@/db/schema";

/**
 * Reads of missing-receipt exceptions (#604): the organization setting and an
 * expense's exception view. Kept apart from the save path so the report store
 * can use them without an import cycle.
 */

type Executor = Pick<typeof appDb, "select">;

/** Whether the organization allows exceptions; a missing settings row means no. */
export async function loadReceiptExceptionsAllowed(
	database: Executor,
	organizationId: string,
	options: { lock?: "share" } = {},
): Promise<boolean> {
	const query = database
		.select({ allowed: travelExpenseSettings.missingReceiptExceptionsAllowed })
		.from(travelExpenseSettings)
		.where(eq(travelExpenseSettings.organizationId, organizationId))
		.limit(1);
	// Shared lock: a submission or save serializes with a concurrent change of the setting.
	const [row] = await (options.lock === "share" ? query.for("share") : query);
	return row?.allowed === true;
}

/** The exception of an expense as the editor sees it. */
export interface ReceiptExceptionView {
	/** Null when no exception is requested. */
	reason: string | null;
	/** Advances on every saved change; 0 when it never had one. */
	version: number;
}

/** Item-view fields of the exception, from an item row. */
export function receiptExceptionItemView(row: {
	receiptExceptionReason: string | null;
	receiptExceptionVersion: number;
}): { receiptException: ReceiptExceptionView } {
	return {
		receiptException: { reason: row.receiptExceptionReason, version: row.receiptExceptionVersion },
	};
}
