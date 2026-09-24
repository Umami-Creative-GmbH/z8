/**
 * Server-side release gate for the employee offboarding and rehire workflow.
 *
 * Stays false until all three delivery slices (#340, #339, #341) meet the
 * acceptance criteria of spec #338. While false, new departure/rehire commands
 * are rejected and existing lifecycle behavior remains in charge. Effective
 * departures that already exist are still enforced regardless of this gate.
 */
export const EMPLOYEE_OFFBOARDING_RELEASE_READY: boolean = false;

export function assertEmployeeOffboardingReleased(): void {
	if (!EMPLOYEE_OFFBOARDING_RELEASE_READY) {
		throw new Error("employee_offboarding_not_released");
	}
}
