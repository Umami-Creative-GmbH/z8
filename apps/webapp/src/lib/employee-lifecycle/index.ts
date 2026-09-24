import "server-only";

import type { createDepartureCommands } from "./commands";
import { createProductionDepartureCommands } from "./runtime";

export { employeeHasOrganizationAccess, resolveEmployeeOrganizationAccess } from "./access";
export { DepartureCommandError, type DepartureCommandErrorCode } from "./commands";
export { assertEmployeeOffboardingReleased, EMPLOYEE_OFFBOARDING_RELEASE_READY } from "./release";

/**
 * Production composition of the departure commands with the canonical
 * clock-out. Server actions check the release gate before reaching this.
 */
export function getDepartureCommands(): ReturnType<typeof createDepartureCommands> {
	return createProductionDepartureCommands();
}
