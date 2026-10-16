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
 * caller runs it inside `withOrganizationConfigurationMutation`, whose
 * exclusive organization configuration guard drains every work transaction
 * holding the shared guard: no closure that read the requirement as active can
 * mark work after this clear commits. A departure's work transaction holds no
 * organization guard (ADR 0003) and is not fenced by it.
 */
import { and, eq } from "drizzle-orm";
import { timeRecordAllocation, workPeriod } from "@/db/schema";
import type { WorkTransactionClient } from "../work-transaction";

export type ProjectMissingTasksCleared = { workPeriods: number; allocations: number };

export async function clearProjectMissingTasks(
	transaction: WorkTransactionClient,
	scope: { organizationId: string; projectId: string },
): Promise<ProjectMissingTasksCleared> {
	const periods = await transaction
		.update(workPeriod)
		.set({ missingTask: false })
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.projectId, scope.projectId),
				eq(workPeriod.missingTask, true),
			),
		)
		.returning({ id: workPeriod.id });
	const allocations = await transaction
		.update(timeRecordAllocation)
		.set({ missingTask: false })
		.where(
			and(
				eq(timeRecordAllocation.organizationId, scope.organizationId),
				eq(timeRecordAllocation.projectId, scope.projectId),
				eq(timeRecordAllocation.allocationKind, "project"),
				eq(timeRecordAllocation.missingTask, true),
			),
		)
		.returning({ id: timeRecordAllocation.id });
	return { workPeriods: periods.length, allocations: allocations.length };
}
