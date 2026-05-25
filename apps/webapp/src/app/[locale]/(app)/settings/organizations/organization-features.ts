export const ORGANIZATION_FEATURES = [
	"shiftsEnabled",
	"projectsEnabled",
	"surchargesEnabled",
	"demoDataEnabled",
	"worksCouncilEnabled",
] as const;

export type OrganizationFeature = (typeof ORGANIZATION_FEATURES)[number];

export function isOrganizationFeature(feature: string): feature is OrganizationFeature {
	return ORGANIZATION_FEATURES.includes(feature as OrganizationFeature);
}
