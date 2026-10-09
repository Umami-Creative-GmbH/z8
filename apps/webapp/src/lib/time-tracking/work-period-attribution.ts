import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { AMEND_COMPLETED_WORK_COMMAND_VERSION, amendCompletedWork } from "./amend-completed-work";
import { attributionIntent } from "./close-active-work";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import { taskIdAfter, taskIntentFollowingProject } from "./task-attribution";

/**
 * Standalone project change of the owner's own work period (#286). Adopted
 * organizations run the completed-work operation: the period, the canonical
 * project allocation and the work revision change together, eligibility is
 * re-checked under the locks and a receipt records the change. Legacy
 * organizations keep the period-only update inside the coordinated transaction.
 *
 * The request carries no identity, so the server generates one: it names the
 * committed operation but cannot prove that a later identical request is a retry.
 *
 * The task follows the project (#873): 	askId undefined keeps the period's task
 * while the project stays and clears it when the project changes, null clears
 * it, an ID books the task. A task-only change is an amend like a project change.
 */
export async function changeWorkPeriodProject(input: {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	period: Pick<
		typeof workPeriod.$inferSelect,
		"id" | "clockInId" | "clockOutId" | "startTime" | "endTime" | "projectId" | "taskId"
	>;
	projectId: string | null;
	taskId?: string | null;
}): Promise<void> {
	await withCompletedWorkTransaction(
		{
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			actorUserId: input.actorUserId,
		},
		async (scope) => {
			if (scope.admission === "legacy") {
				await scope.db
					.update(workPeriod)
					.set({
						projectId: input.projectId,
						taskId: taskIdAfter(
							taskIntentFollowingProject({
								task: input.taskId === undefined ? undefined : attributionIntent(input.taskId),
								projectId: input.projectId,
								currentProjectId: input.period.projectId,
							}),
							input.period.taskId,
						),
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(workPeriod.id, input.period.id),
							eq(workPeriod.organizationId, input.organizationId),
							isNull(workPeriod.deletedAt),
						),
					);
				return;
			}
			await amendCompletedWork(scope, {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				actorUserId: input.actorUserId,
				authority: "owner",
				writer: "work_period_attribution_edit",
				command: {
					version: AMEND_COMPLETED_WORK_COMMAND_VERSION,
					operationId: randomUUID(),
					request: {
						workPeriodId: input.period.id,
						projectId: input.projectId,
						// Absent unless named, keeping earlier receipts' shape.
						...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
					},
				},
				intent: {
					workPeriodId: input.period.id,
					clockIn: { kind: "preserve" },
					clockOut: { kind: "preserve" },
					project: input.projectId ? { kind: "replace", id: input.projectId } : { kind: "clear" },
					...(input.taskId !== undefined ? { task: attributionIntent(input.taskId) } : {}),
					workCategory: { kind: "preserve" },
					workLocation: { kind: "preserve" },
					notes: null,
				},
				expectedSource: {
					clockInId: input.period.clockInId,
					clockOutId: input.period.clockOutId,
					startAt: instantFromDate(input.period.startTime),
					endAt: input.period.endTime ? instantFromDate(input.period.endTime) : null,
				},
				evaluatedAt: systemClock.nowInstant(),
				request: { ipAddress: null, deviceInfo: null },
			});
		},
	);
}
