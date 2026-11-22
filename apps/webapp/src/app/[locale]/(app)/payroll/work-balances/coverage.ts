import "server-only";

import { db } from "@/db";
import { getAuthContext, getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import {
	type BalanceAdjustmentGrantEmployee,
	listBalanceAdjustmentGrantEmployees,
	listOrganizationBalanceAdjustmentEmployees,
} from "@/lib/payroll-access/adjustment-coverage";

/**
 * The employees the signed-in payroll actor covers for balance adjustments in their
 * active organization, including those who have left (#995, #1957): org-wide for org
 * admins, active payroll access grant scope for delegated payroll officers, or null
 * without payroll access. `employeeId` narrows it to one.
 */
export async function loadPayrollWorkBalanceEmployees(
	employeeId?: string,
): Promise<BalanceAdjustmentGrantEmployee[] | null> {
	const [authContext, settingsCaller] = await Promise.all([
		getAuthContext(),
		getCurrentSettingsAccess?.() ?? Promise.resolve(null),
	]);
	const organizationId = authContext?.session.activeOrganizationId;
	if (!authContext || !organizationId) return null;
	if (
		settingsCaller?.settingsAccess &&
		settingsCaller.organizationId === organizationId &&
		meetsSettingsAccess(settingsCaller.settingsAccess, "orgAdmin")
	) {
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
