/**
 * - `full`: the feature is on and the viewer administers the organization.
 * - `retention_only`: the feature is off, but retained check records or legal-case holds
 *   still exist, so administrators keep Retention & holds while cleanup continues.
 * - `hidden`: no settings entry and no settings page.
 */
export type DrivingLicenceSettingsVisibility = "full" | "retention_only" | "hidden";

/**
 * Who sees driving licence control in one organization (#1418), as answered by
 * `readDrivingLicenceVisibility`. Every surface decides through it: the sidebar item,
 * `/driving-licence`, the clock advisory and the settings entry and page.
 *
 * The role facts are resolved only while the feature is on: while it is off nobody holds
 * a driving licence role, and only `settings` can still be `retention_only`.
 */
export interface DrivingLicenceVisibility {
	/** The driving licence policy's enabled value, the feature's only on/off. */
	featureEnabled: boolean;
	intendedDriver: boolean;
	/** The viewer's own check records are still retained (also after they stop being an intended driver). */
	ownRetainedRecords: boolean;
	/** The viewer holds a current, unexpired verifier grant. */
	verifier: boolean;
	/** The viewer holds the planning permission `read:DrivingAuthorization`. */
	planner: boolean;
	settings: DrivingLicenceSettingsVisibility;
}

export const HIDDEN_DRIVING_LICENCE_VISIBILITY: DrivingLicenceVisibility = {
	featureEnabled: false,
	intendedDriver: false,
	ownRetainedRecords: false,
	verifier: false,
	planner: false,
	settings: "hidden",
};

/** The `/driving-licence` tabs the viewer may open. */
export function drivingLicenceRoles(visibility: DrivingLicenceVisibility) {
	const on = visibility.featureEnabled;
	return {
		myLicence: on && (visibility.intendedDriver || visibility.ownRetainedRecords),
		checks: on && visibility.verifier,
		planning: on && visibility.planner,
	};
}
/** The personal sidebar item and `/driving-licence` itself: on, and at least one role. */
export function showsDrivingLicenceNavigation(visibility: DrivingLicenceVisibility) {
	const roles = drivingLicenceRoles(visibility);
	return roles.myLicence || roles.checks || roles.planning;
}
/** The clock widget and popover advisory: on, and only to intended drivers. */
export function showsDrivingAuthorizationAdvisory(visibility: DrivingLicenceVisibility) {
	return visibility.featureEnabled && visibility.intendedDriver;
}
/** The settings entry and page, in either form. */
export function showsDrivingLicenceSettings(visibility: DrivingLicenceVisibility) {
	return visibility.settings !== "hidden";
}
