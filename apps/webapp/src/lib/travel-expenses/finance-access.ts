import "server-only";
import { db } from "@/db";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { officerScopeOf } from "./expense-officer-grant";
import { loadActiveExpenseOfficerGrant } from "./expense-officer-grant-store";
import {
	canExportTravelExpenses,
	canReadTravelExpenseFinance,
	canSettleTravelExpenses,
} from "./finance-permissions";
import { type FinanceScopes, resolveFinanceScopes } from "./officer-scope";
import { isSourceInOfficerScope } from "./officer-scope-read";
import type { SettlementSource } from "./settlement-store";

export interface FinanceActor {
	organizationId: string;
	employeeId: string;
	userId: string;
	/** Reads some approved reports; `scopes.read` says which. */
	canRead: boolean;
	/** Records reimbursements and recoveries for some; `scopes.settle` says which. */
	canSettle: boolean;
	/** Export batches (#613) of some; `scopes.export` says which. Implies `canRead`. */
	canExport: boolean;
	scopes: FinanceScopes;
}

/**
 * The signed-in employee's travel expense finance access in their active
 * organization, or null without an employee there (#612, #747). Owners and
 * admins handle every approved report; an expense officer handles the reports
 * in their grant's scope, with its capabilities. Custom roles never grant
 * finance access (#748). Reviewing expenses never grants it either.
 */
export async function loadFinanceActor(): Promise<FinanceActor | null> {
	const [actor, ability] = await Promise.all([getAuthContext(), getAbility()]);
	if (!actor?.employee || !ability) return null;
	const organizationId = actor.employee.organizationId;
	const activeOrganizationId = actor.session.activeOrganizationId ?? null;
	// A grant applies only in the organization the session is working in.
	const grant =
		organizationId === activeOrganizationId
			? await loadActiveExpenseOfficerGrant(db, {
					organizationId,
					officerEmployeeId: actor.employee.id,
				})
			: null;
	const scopes = resolveFinanceScopes({
		organizationWide: {
			read: canReadTravelExpenseFinance(ability, organizationId, activeOrganizationId),
			settle: canSettleTravelExpenses(ability, organizationId, activeOrganizationId),
			export: canExportTravelExpenses(ability, organizationId, activeOrganizationId),
		},
		grant: grant
			? {
					scope: officerScopeOf(grant),
					canExport: grant.canExport,
					canRecordReimbursements: grant.canRecordReimbursements,
				}
			: null,
	});
	return {
		organizationId,
		employeeId: actor.employee.id,
		userId: actor.user.id,
		canRead: scopes.read !== null,
		canSettle: scopes.settle !== null,
		canExport: scopes.export !== null && scopes.read !== null,
		scopes,
	};
}

/**
 * Whether the actor reads this approved report or legacy claim of their
 * organization as finance. Out of scope reads as not found everywhere.
 */
export async function financeActorReads(
	actor: FinanceActor | null,
	subject: { source: SettlementSource; employeeId: string },
): Promise<boolean> {
	if (!actor) return false;
	return isSourceInOfficerScope(db, actor.scopes.read, {
		organizationId: actor.organizationId,
		...subject,
	});
}
