import "server-only";

/**
 * Ends every missing-task marker of a project (#884, Projects ADR 0002): its
 * task requirement was turned off. Both records of each booking are cleared
 * together, the work period and its canonical project allocation, so a pair
 * that agreed keeps agreeing.
 *
 * The marker is a hint, not attribution (decisions on #884): clearing it
 * changes no project, task or time, advances no work revision and sends no
 * submitted period back. It clears in closed months too; the closed-month
 * guard does not cover the marker column.
 *
 * It spans every employee's work, so it runs on no employee's work scope. The
 * caller runs it inside `withOrganizationConfigurationMutation`, after it
 * updated the project row in the same transaction:
 * - the exclusive organization configuration guard drains every work
 *   transaction holding the shared guard, so no split or amendment copies a
 *   marker past this clear;
 * - the project row's update lock fences every closure, departures included
 *   (they hold no organization guard, ADR 0003): a closure reads the
 *   requirement with the project row `FOR SHARE` (`closesMissingTask`), so it
 *   either commits its marker before the turn-off locks the row, and this
 *   clear ends it, or waits and reads the requirement as off.
 *
 * Lock order: organization configuration guard, then the project row, then the
 * marked work rows. A departure closure takes the project row after its own
 * work rows (configuration reads come after the pair in
 * `WORK_RECORD_LOCK_ORDER`); the work it closes is live and unmarked, so this
 * clear never waits on it, and the two cannot wait on each other in a cycle.
 */
import { and, eq } from "drizzle-orm";
import { timeRecordAllocation, workPeriod } from "@/db/schema";
import type { WorkTransactionClient } from "../work-transaction";

export async function clearProjectMissingTasks(
	transaction: WorkTransactionClient,
	scope: { organizationId: string; projectId: string },
): Promise<void> {
	await transaction
		.update(workPeriod)
		.set({ missingTask: false })
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.projectId, scope.projectId),
				eq(workPeriod.missingTask, true),
			),
		);
	await transaction
		.update(timeRecordAllocation)
		.set({ missingTask: false })
		.where(
			and(
				eq(timeRecordAllocation.organizationId, scope.organizationId),
				eq(timeRecordAllocation.projectId, scope.projectId),
				eq(timeRecordAllocation.allocationKind, "project"),
				eq(timeRecordAllocation.missingTask, true),
			),
		);
}
