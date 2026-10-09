import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { AMEND_COMPLETED_WORK_COMMAND_VERSION, amendCompletedWork } from "./amend-completed-work";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import { PROJECT_TASK_INELIGIBILITY_MESSAGES, projectTaskIneligibility } from "./project-eligibility";
import { namedTaskId, namedTaskIntent, taskIdFollowingProject } from "./task-attribution";

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
 * The task follows the project (#873): `taskId` undefined keeps the period's task
 * while the project stays and clears it when the project changes, null clears
 * it, an ID books the task. A task-only change is an amend like a project change.
 * Either way a newly booked task is re-checked under its row lock inside the
 * write, refusing as a `ValidationError` on `taskId` whose `value` is the reason.
 */
export async function changeWorkPeriodProject(input: {
	organizationId: string;
	employeeId: string;
	teamId: string | null;
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
				await changeLegacyPeriod(scope.db, input);
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
						...namedTaskId(input.taskId),
					},
				},
				intent: {
					workPeriodId: input.period.id,
					clockIn: { kind: "preserve" },
					clockOut: { kind: "preserve" },
					project: input.projectId ? { kind: "replace", id: input.projectId } : { kind: "clear" },
					...namedTaskIntent(input.taskId),
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

type LegacyWriter = Parameters<Parameters<typeof withCompletedWorkTransaction>[1]>[0]["db"];

/**
 * The legacy period-only change. The task follows the period as it is now,
 * re-read under its row lock rather than taken from the caller's earlier read.
 */
async function changeLegacyPeriod(
	tx: LegacyWriter,
	input: Parameters<typeof changeWorkPeriodProject>[0],
) {
	const scope = and(
		eq(workPeriod.id, input.period.id),
		eq(workPeriod.organizationId, input.organizationId),
		isNull(workPeriod.deletedAt),
	);
	const [current] = await tx
		.select({ projectId: workPeriod.projectId, taskId: workPeriod.taskId })
		.from(workPeriod)
		.where(scope)
		.for("update");
	if (!current) return;
	const { task } = namedTaskIntent(input.taskId);
	const taskId = taskIdFollowingProject({ task, projectId: input.projectId, current });
	if (task?.kind === "replace" && taskId) {
		const reason = await projectTaskIneligibility(
			{ employeeId: input.employeeId, teamId: input.teamId, organizationId: input.organizationId },
			{ projectId: input.projectId, taskId },
			tx,
			{ lock: "share" },
		);
		if (reason) {
			throw new ValidationError({
				message: PROJECT_TASK_INELIGIBILITY_MESSAGES[reason],
				field: "taskId",
				value: reason,
			});
		}
	}
	await tx
		.update(workPeriod)
		.set({ projectId: input.projectId, taskId, updatedAt: new Date() })
		.where(scope);
}
