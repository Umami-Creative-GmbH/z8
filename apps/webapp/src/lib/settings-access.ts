export type SettingsAccessTier = "none" | "member" | "manager" | "entityAdmin" | "orgAdmin";

export const ORG_ADMIN_SETTINGS_ROUTES = [
	"/settings/organizations",
	"/settings/billing",
	"/settings/avv",
	"/settings/roles",
	"/settings/travel-expenses",
	"/settings/legal-entities",
	"/settings/enterprise/domains",
	"/settings/enterprise/email",
	"/settings/email-templates",
	"/settings/enterprise/api-keys",
	"/settings/enterprise/audit-log",
	"/settings/telegram",
	"/settings/slack",
	"/settings/discord",
	"/settings/teams-notifications",
	"/settings/webhooks",
	"/settings/export",
	"/settings/payroll-export",
	"/settings/payroll-readiness",
	"/settings/audit-export",
	"/settings/demo",
	"/settings/import",
	"/settings/export-operations",
	"/settings/scheduled-exports",
] as const;

export type SettingsAccessMembershipRole = "owner" | "admin" | "member" | null;

export type SettingsAccessEmployeeRole = "admin" | "manager" | "employee" | null;

export interface ResolveSettingsAccessTierInput {
	activeOrganizationId: string | null;
	membershipRole: SettingsAccessMembershipRole;
	employeeRole: SettingsAccessEmployeeRole;
	legalEntityAdminIds?: string[];
}

export function isSettingsAccessMembershipRole(
	role: string | null | undefined,
): role is Exclude<SettingsAccessMembershipRole, null> {
	return role === "owner" || role === "admin" || role === "member";
}

const SETTINGS_ACCESS_RANK: Record<SettingsAccessTier, number> = {
	none: 0,
	member: 1,
	manager: 2,
	entityAdmin: 3,
	orgAdmin: 4,
};

export function resolveSettingsAccessTier({
	activeOrganizationId,
	membershipRole,
	employeeRole,
	legalEntityAdminIds = [],
}: ResolveSettingsAccessTierInput): SettingsAccessTier {
	if (!activeOrganizationId) {
		return "member";
	}

	if (membershipRole === "owner" || membershipRole === "admin") {
		return "orgAdmin";
	}

	if (legalEntityAdminIds.length > 0) {
		return "entityAdmin";
	}

	if (employeeRole === "admin" || employeeRole === "manager") {
		return "manager";
	}

	return "member";
}

export function hasSettingsAccessTier(
	currentTier: SettingsAccessTier,
	requiredTier: SettingsAccessTier,
): boolean {
	return SETTINGS_ACCESS_RANK[currentTier] >= SETTINGS_ACCESS_RANK[requiredTier];
}

export function canResolvedTierAccessRoute(accessTier: SettingsAccessTier, route: string): boolean {
	if (!ORG_ADMIN_SETTINGS_ROUTES.includes(route as (typeof ORG_ADMIN_SETTINGS_ROUTES)[number])) {
		return true;
	}

	return hasSettingsAccessTier(accessTier, "orgAdmin");
}
