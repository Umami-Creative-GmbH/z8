/**
 * Server-side release gate for the employee offboarding and rehire workflow.
 *
 * All three delivery slices (#340, #339, #341) are implemented, but the gate
 * stays false until the browser verification required by #341 task 3.7 has
 * run against a database with migrations 0071–0077 applied. While false, new
 * departure/rehire commands are rejected and the maintenance job pauses;
 * effective departures that already exist are still enforced regardless.
 * See docs/refs/employee-offboarding.md ("Release gate") before changing it.
 */
export const EMPLOYEE_OFFBOARDING_RELEASE_READY: boolean = false;

export function assertEmployeeOffboardingReleased(): void {
	if (!EMPLOYEE_OFFBOARDING_RELEASE_READY) {
		throw new Error("employee_offboarding_not_released");
	}
}
