import "server-only";

import { db } from "@/db";
import { getAuthContext } from "@/lib/auth-helpers";
import {
	type BalanceAdjustmentGrantEmployee,
	listBalanceAdjustmentGrantEmployees,
} from "@/lib/payroll-access/adjustment-coverage";

/**
 * The employees the signed-in user's payroll access grant covers for balance
 * adjustments in their active organization, including those who have left
 * (#995); null without an active grant. `employeeId` narrows it to one.
 */
export async function loadPayrollWorkBalanceEmployees(
	employeeId?: string,
): Promise<BalanceAdjustmentGrantEmployee[] | null> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;
	if (!authContext || !organizationId) return null;
	const coverage = await listBalanceAdjustmentGrantEmployees(db, {
		organizationId,
		actorUserId: authContext.user.id,
		employeeId,
	});
	return coverage?.employees ?? null;
}
