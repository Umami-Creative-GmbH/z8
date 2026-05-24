import type { AppAbility } from "@/lib/authorization/ability";

function hasActiveOrganizationScope(
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return organizationId.length > 0 && organizationId === activeOrganizationId;
}

export function canViewWorksCouncilPortal(
	ability: AppAbility,
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return (
		hasActiveOrganizationScope(organizationId, activeOrganizationId) &&
		ability.can("read", "WorksCouncil")
	);
}

export function canExportWorksCouncilReview(
	ability: AppAbility,
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return (
		hasActiveOrganizationScope(organizationId, activeOrganizationId) &&
		ability.can("export", "WorksCouncil")
	);
}

export function canConfigureWorksCouncilMode(
	ability: AppAbility,
	organizationId: string,
	activeOrganizationId: string | null,
): boolean {
	return (
		hasActiveOrganizationScope(organizationId, activeOrganizationId) &&
		ability.can("configure", "WorksCouncil")
	);
}
