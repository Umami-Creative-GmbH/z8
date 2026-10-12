import type { AppAbility } from "@/lib/authorization/ability";

/**
 * Closing and reopening months (#762) are separate CASL actions on
 * `PayrollPeriod`, so a custom role can grant either. By default owners and
 * admins close and only owners reopen. Always checked against the active
 * organization of the session.
 */

function inActiveOrganization(
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return organizationId.length > 0 && organizationId === activeOrganizationId;
}

export function canCloseMonths(
	ability: AppAbility,
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return (
		inActiveOrganization(organizationId, activeOrganizationId) &&
		ability.can("close", "PayrollPeriod")
	);
}

export function canReopenMonths(
	ability: AppAbility,
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return (
		inActiveOrganization(organizationId, activeOrganizationId) &&
		ability.can("reopen", "PayrollPeriod")
	);
}
