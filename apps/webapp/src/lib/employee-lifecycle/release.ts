/**
 * Server-side release gate for the employee offboarding and rehire workflow.
 *
 * All three delivery slices (#340, #339, #341) and unified contract / leaving-date
 * integration (Spec #1921) are verified in live English and German browser testing
 * against PostgreSQL 16 migrated through 0327 (#341 task 3.7, #1931).
 *
 * Rollback: setting this flag back to false stops new departure/rehire commands and
 * pauses departure maintenance while preserving enforcement of already-effective
 * departures and due cutoffs at the database boundary.
 * See docs/refs/employee-offboarding.md ("Release gate and rollback").
 */
export const EMPLOYEE_OFFBOARDING_RELEASE_READY: boolean = true;

export function assertEmployeeOffboardingReleased(): void {
	if (!EMPLOYEE_OFFBOARDING_RELEASE_READY) {
		throw new Error("employee_offboarding_not_released");
	}
}
