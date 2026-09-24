import "server-only";

import type { createDepartureCommands } from "./commands";

export { employeeHasOrganizationAccess, resolveEmployeeOrganizationAccess } from "./access";
export { DepartureCommandError, type DepartureCommandErrorCode } from "./commands";
export { assertEmployeeOffboardingReleased, EMPLOYEE_OFFBOARDING_RELEASE_READY } from "./release";

/**
 * Production composition of the departure commands. The canonical clock-out
 * adapter arrives with #339 (Slice 2); until then there is deliberately no
 * composition, so a departure can never take effect with a no-op timer close.
 * Server actions check the release gate before reaching this.
 */
export function getDepartureCommands(): ReturnType<typeof createDepartureCommands> {
	throw new Error("employee_offboarding_clock_out_unavailable");
}
