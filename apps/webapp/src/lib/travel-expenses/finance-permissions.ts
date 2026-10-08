import type { AppAbility } from "@/lib/authorization/ability";

/**
 * Organization-wide travel expense finance access (#612): its own CASL subject,
 * held by organization owners and admins only. Everyone else gets finance
 * access through an expense officer grant (#748, ADR 0001), never a custom
 * role. Approval authority (the `Approval` subject, manager links) never
 * implies it. Always checked against the active organization of the session.
 */

function inActiveOrganization(
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
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

/**
 * Export batches (#613). A batch carries the organization's approved evidence
 * and receipt files, so exporting also needs finance read: the export
 * permission alone never opens org-wide receipts.
 */
export function canExportTravelExpenses(
	ability: AppAbility,
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return (
		canReadTravelExpenseFinance(ability, organizationId, activeOrganizationId) &&
		ability.can("export", "TravelExpenseFinance")
	);
}
