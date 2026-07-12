export type OrganizationFeature =
	| "shiftsEnabled"
	| "projectsEnabled"
	| "surchargesEnabled"
	| "demoDataEnabled"
	| "worksCouncilEnabled";

export type OrganizationFeatureState = Record<OrganizationFeature, boolean>;

export function organizationFeatureReducer(
	state: OrganizationFeatureState,
	action: { type: "set"; feature: OrganizationFeature; enabled: boolean },
): OrganizationFeatureState {
	return { ...state, [action.feature]: action.enabled };
}
