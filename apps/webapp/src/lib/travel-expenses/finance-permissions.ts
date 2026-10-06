import type { AppAbility } from "@/lib/authorization/ability";

/**
 * Travel expense finance access (#612): its own CASL subject, granted to
 * organization owners/admins or through custom roles. Approval authority (the
 * `Approval` subject, manager links) never implies it. Always checked against
 * the active organization of the session.
 */

function inActiveOrganization(organizationId: string, activeOrganizationId: string | null): boolean {
	return organizationId.length > 0 && organizationId === activeOrganizationId;
}

/** Finance queue, approved evidence (frozen revisions, receipts) and balances. */
export function canReadTravelExpenseFinance(
	ability: AppAbility,
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return (
		inActiveOrganization(organizationId, activeOrganizationId) &&
		ability.can("read", "TravelExpenseFinance")
	);
}

/** Recording reimbursements (and, with #615, recoveries). */
export function canSettleTravelExpenses(
	ability: AppAbility,
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return (
		inActiveOrganization(organizationId, activeOrganizationId) &&
		ability.can("settle", "TravelExpenseFinance")
	);
}

/** Export batches (#613). */
export function canExportTravelExpenses(
	ability: AppAbility,
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return (
		inActiveOrganization(organizationId, activeOrganizationId) &&
		ability.can("export", "TravelExpenseFinance")
	);
}
