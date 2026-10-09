export const ORGANIZATION_FEATURES = [
	"shiftsEnabled",
	"projectsEnabled",
	"surchargesEnabled",
	"demoDataEnabled",
	"worksCouncilEnabled",
	"billableTimeEnabled",
] as const;

export type OrganizationFeature = (typeof ORGANIZATION_FEATURES)[number];

export function isOrganizationFeature(feature: string): feature is OrganizationFeature {
	return ORGANIZATION_FEATURES.includes(feature as OrganizationFeature);
}

/**
 * Features the generic toggle must not write. Billable Time needs projects and a
 * billable currency when it is switched on, so it goes through `switchBillableTime`.
 */
export function requiresDedicatedSwitch(feature: OrganizationFeature): boolean {
	return feature === "billableTimeEnabled";
}

/**
 * The organization columns one generic feature toggle writes. Billable Time
 * requires projects, so switching projects off switches Billable Time off too
 * (its settings and data are kept). Switching projects back on leaves Billable
 * Time off.
 */
export function organizationFeatureUpdate(
	feature: OrganizationFeature,
	enabled: boolean,
): Partial<Record<OrganizationFeature, boolean>> {
	if (feature === "projectsEnabled" && !enabled) {
		return { projectsEnabled: false, billableTimeEnabled: false };
	}
	return { [feature]: enabled };
}
