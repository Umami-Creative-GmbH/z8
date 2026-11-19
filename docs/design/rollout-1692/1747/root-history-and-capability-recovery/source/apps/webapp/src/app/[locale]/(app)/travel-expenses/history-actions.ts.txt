"use server";

import { db } from "@/db";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import type { ExpenseHistoryRow } from "@/lib/travel-expenses/expense-history";
import { listOwnExpenseHistory } from "@/lib/travel-expenses/expense-history-store";

/**
 * The employee's own unified expense history (#617): reports in every status
 * and earlier claims, with the balances of approved ones.
 */
export async function getMyTravelExpenseHistory(): Promise<
	ServerActionResult<ExpenseHistoryRow[]>
> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) return { success: false, error: "Unauthorized" };
		return {
			success: true,
			data: await listOwnExpenseHistory(db, {
				organizationId: authContext.employee.organizationId,
				employeeId: authContext.employee.id,
				userId: authContext.user.id,
			}),
		};
	} catch (error) {
		logger.error({ error }, "Failed to load the travel expense history");
		return { success: false, error: "Failed to load your travel expenses" };
	}
}
