/**
 * Server-side release gate for the employee offboarding and rehire workflow.
 *
 * Opened by #341 once all three delivery slices (#340, #339, #341) met the
 * acceptance criteria of spec #338. Setting it back to false rejects new
 * departure/rehire commands and pauses the maintenance job; effective
 * departures that already exist are still enforced regardless of this gate.
 * See docs/refs/employee-offboarding.md before changing it.
 */
export const EMPLOYEE_OFFBOARDING_RELEASE_READY: boolean = true;

export function assertEmployeeOffboardingReleased(): void {
	if (!EMPLOYEE_OFFBOARDING_RELEASE_READY) {
		throw new Error("employee_offboarding_not_released");
	}
}
