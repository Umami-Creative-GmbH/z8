import "server-only";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import {
	canExportTravelExpenses,
	canReadTravelExpenseFinance,
	canSettleTravelExpenses,
} from "./finance-permissions";

export interface FinanceActor {
	organizationId: string;
	employeeId: string;
	userId: string;
	canRead: boolean;
	canSettle: boolean;
	/** Export batches (#613). */
	canExport: boolean;
}

/**
 * The signed-in employee's travel expense finance access in their active
 * organization (#612), or null without an employee there. Finance access is
 * its own permission; reviewing expenses never grants it.
 */
export async function loadFinanceActor(): Promise<FinanceActor | null> {
	const [actor, ability] = await Promise.all([getAuthContext(), getAbility()]);
	if (!actor?.employee || !ability) return null;
	const organizationId = actor.employee.organizationId;
	const activeOrganizationId = actor.session.activeOrganizationId ?? null;
	return {
		organizationId,
		employeeId: actor.employee.id,
		userId: actor.user.id,
		canRead: canReadTravelExpenseFinance(ability, organizationId, activeOrganizationId),
		canSettle: canSettleTravelExpenses(ability, organizationId, activeOrganizationId),
		canExport: canExportTravelExpenses(ability, organizationId, activeOrganizationId),
	};
}
