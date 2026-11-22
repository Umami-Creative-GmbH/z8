/**
 * App paths that driving licence links lead to (#1429, #1937). Pure and client-safe: reminders,
 * tasks, notifications, email, checklists and the Checks table all build their links here.
 */

/** The employee's own page: My driving licence, in the Workplace section. */
export const MY_DRIVING_LICENCE_PATH = "/driving-licence";

/** Verifiers' Checks and planners' Planning, in the Team & organization section (#1937). */
export const TEAM_DRIVING_LICENCE_PATH = "/team/driving-licence";

/** One employee's check page. Only verifiers covering that employee can open it. */
export function drivingLicenceCheckPath(employeeId: string): string {
	return `${TEAM_DRIVING_LICENCE_PATH}/${encodeURIComponent(employeeId)}`;
}

/** The Verifiers tab of the driving licence settings: where reassignment tasks are resolved. */
export const DRIVING_LICENCE_VERIFIER_SETTINGS_PATH = "/settings/driving-licence?tab=verifiers";

/** The Intended drivers tab of the driving licence settings. */
export const DRIVING_LICENCE_INTENDED_DRIVERS_SETTINGS_PATH =
	"/settings/driving-licence?tab=intended-drivers";
