import "server-only";

import { db } from "@/db";
import { getAuthContext } from "@/lib/auth-helpers";
import {
	type BalanceAdjustmentGrantEmployee,
	listBalanceAdjustmentGrantEmployees,
	listOrganizationBalanceAdjustmentEmployees,
} from "@/lib/payroll-access/adjustment-coverage";
import { isOrgAdminForOrganization } from "@/lib/payroll-access/org-admin";

/**
 * The employees the signed-in payroll actor covers for balance adjustments in their
 * active organization, including those who have left (#995, #1957): org-wide for org
 * admins, active payroll access grant scope for delegated payroll officers, or null
 * without payroll access. `employeeId` narrows it to one.
 */
export async function loadPayrollWorkBalanceEmployees(
	employeeId?: string,
): Promise<BalanceAdjustmentGrantEmployee[] | null> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;
	if (!authContext || !organizationId) return null;
	if (await isOrgAdminForOrganization(organizationId)) {
		return listOrganizationBalanceAdjustmentEmployees(db, {
			organizationId,
			employeeId,
		});
	}
	const coverage = await listBalanceAdjustmentGrantEmployees(db, {
		organizationId,
		actorUserId: authContext.user.id,
		employeeId,
	});
	return coverage?.employees ?? null;
}
