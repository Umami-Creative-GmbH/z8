/**
 * App paths that driving licence links lead to (#1429). Pure and client-safe: reminders,
 * tasks, notifications, email and the Checks table all build their links here.
 */

/** The employee's own page (My licence) and the verifier's Checks table. */
export const DRIVING_LICENCE_PATH = "/driving-licence";

/** One employee's check page. Only verifiers covering that employee can open it. */
export function drivingLicenceCheckPath(employeeId: string): string {
	return `${DRIVING_LICENCE_PATH}/checks/${encodeURIComponent(employeeId)}`;
}
