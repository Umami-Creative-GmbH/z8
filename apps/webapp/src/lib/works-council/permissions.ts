import type { AppAbility } from "@/lib/authorization/ability";

export function canViewWorksCouncilPortal(ability: AppAbility, organizationId: string): boolean {
	return ability.can("read", "WorksCouncil") && organizationId.length > 0;
}

export function canExportWorksCouncilReview(ability: AppAbility, organizationId: string): boolean {
	return ability.can("export", "WorksCouncil") && organizationId.length > 0;
}

export function canConfigureWorksCouncilMode(ability: AppAbility, organizationId: string): boolean {
	return ability.can("configure", "WorksCouncil") && organizationId.length > 0;
}
