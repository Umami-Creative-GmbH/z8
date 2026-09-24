import { and, eq } from "drizzle-orm";
import { employee } from "@/db/schema";
import { ClockingAccessError, type ClockingStore } from "@/lib/time-tracking/clocking-core";
import type { WorkTransactionClient } from "@/lib/time-tracking/web-clock-out-transaction";
import { employeeHasOrganizationAccess } from "./access";

/**
 * Refuses a clock action once the employee's access has ended. Runs inside the
 * clocking transaction after the employee advisory lock, which departures also
 * take first, so a clock action racing a cutoff observes the departure's
 * committed outcome. Access is judged at receipt time: a clock-out captured
 * offline before the cutoff but received after it is refused here, and the
 * departure's own clock-out closes the period at the cutoff instead.
 */
export async function assertEmployeeMayClock(
	store: ClockingStore,
	input: { employeeId: string; organizationId: string },
): Promise<void> {
	const tx = store.transaction as WorkTransactionClient;
	const [row] = await tx
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.id, input.employeeId),
				eq(employee.organizationId, input.organizationId),
				employeeHasOrganizationAccess(),
			),
		)
		.limit(1);
	if (!row) throw new ClockingAccessError("employee_required");
}
