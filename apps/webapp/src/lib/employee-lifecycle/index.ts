import "server-only";

import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { createDepartureClockOut } from "./clock-out";
import { createDepartureCommands } from "./commands";

export { employeeHasOrganizationAccess, resolveEmployeeOrganizationAccess } from "./access";
export { DepartureCommandError, type DepartureCommandErrorCode } from "./commands";
export { assertEmployeeOffboardingReleased, EMPLOYEE_OFFBOARDING_RELEASE_READY } from "./release";

/**
 * Production composition of the departure commands with the canonical
 * clock-out. Server actions check the release gate before reaching this.
 */
export function getDepartureCommands(): ReturnType<typeof createDepartureCommands> {
	return createDepartureCommands({
		db,
		clock: systemClock,
		clockOut: createDepartureClockOut(),
	});
}
