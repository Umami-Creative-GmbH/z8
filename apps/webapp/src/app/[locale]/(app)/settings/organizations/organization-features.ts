export const ORGANIZATION_FEATURES = [
	"shiftsEnabled",
	"projectsEnabled",
	"surchargesEnabled",
	"demoDataEnabled",
	"worksCouncilEnabled",
	"personnelFilesEnabled",
] as const;

export type OrganizationFeature = (typeof ORGANIZATION_FEATURES)[number];

export function isOrganizationFeature(feature: string): feature is OrganizationFeature {
	return ORGANIZATION_FEATURES.includes(feature as OrganizationFeature);
}

/**
 * The least organization role that may switch a feature. Personnel files are
 * switched by owners and admins (#865); every other feature stays owner-only.
 */
export function organizationFeatureRequiredRole(feature: OrganizationFeature): "owner" | "admin" {
	return feature === "personnelFilesEnabled" ? "admin" : "owner";
}
