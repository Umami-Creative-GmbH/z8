import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { timeRecordAllocation, workPeriod } from "@/db/schema";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import {
	AMEND_COMPLETED_WORK_COMMAND_VERSION,
	type AmendCompletedWorkIntent,
	type AmendmentAuthority,
	amendCompletedWork,
	lockAuthority,
	replayOrAmendCompletedWork,
} from "./amend-completed-work";
import { assertWorkOpen, workInterval } from "./closed-months/store";
import { sendBackChangedPeriodSubmissions } from "./period-submissions/submission-send-back";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import {
	PROJECT_TASK_INELIGIBILITY_MESSAGES,
	projectTaskIneligibility,
} from "./project-eligibility";
import { namedTaskId, namedTaskIntent, taskIdFollowingProject } from "./task-attribution";
import { resolveWorkBillabilityInTransaction } from "./work-billability";
import { assertNoUnresolvedWorkPeriodReview } from "./work-period-review";
import type { SealedWorkTransactionScope } from "./work-transaction";

type PeriodSource = Pick<
	typeof workPeriod.$inferSelect,
	"id" | "clockInId" | "clockOutId" | "startTime" | "endTime"
>;

type AttributionChange = {
	organizationId: string;
	employeeId: string;
	/** The owner's team, for a newly booked task's eligibility (#873). */
	teamId?: string | null;
	actorUserId: string;
	period: PeriodSource;
	/** Absent keeps the project; null clears it. */
	projectId?: string | null;
	/** Absent lets the task follow the project (#873); null clears it; an ID books it. */
	taskId?: string | null;
	/** Explicit billability (#900); absent applies the attribution rule. */
	billable?: boolean;
};

/**
 * Standalone project change of the owner's own work period (#286). Adopted
 * organizations run the completed-work operation: the period, the canonical
 * project allocation and the work revision change together, eligibility is
 * re-checked under the locks and a receipt records the change. Legacy
 * organizations keep the period-only update inside the coordinated transaction.
 *
 * The new project's billable default applies unless the same edit sets
 * `billable` (#900); setting it with an unchanged project is a billability-only
 * change.
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
export async function changeWorkPeriodProject(
	input: Omit<AttributionChange, "projectId" | "teamId"> & {
		projectId: string | null;
		teamId: string | null;
	},
): Promise<void> {
	await changeWorkPeriodAttribution(input, "owner");
}

/**
 * Billability-only change of a work period (#900), by its employee, an admin, one
 * of the employee's managers, or a project manager of the work's project. It runs
 * the same attribution path as a project change (the `work_period_attribution_edit`
 * writer, no change policy) under the `owner_manager_or_project_manager`
 * authority, which permits nothing but billability. `employeeId` is the work's
 * owner; the actor may be anyone, the operation verifies authority under its locks.
 */
export async function changeWorkPeriodBillability(
	input: Omit<AttributionChange, "projectId" | "taskId" | "billable"> & { billable: boolean },
): Promise<void> {
	await changeWorkPeriodAttribution(input, "owner_manager_or_project_manager");
}

async function changeWorkPeriodAttribution(
	input: AttributionChange,
	authority: Extract<AmendmentAuthority, "owner" | "owner_manager_or_project_manager">,
): Promise<void> {
	await withCompletedWorkTransaction(
		{
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			actorUserId: input.actorUserId,
		},
		async (scope) => {
			if (scope.admission === "legacy") {
				// Legacy writes verify the same authority under the same locks first.
				const authorized = await lockAuthority(scope.db, {
					...input,
					authority,
					workPeriodId: input.period.id,
				});
				await changeLegacyWorkPeriodProject(scope.db, {
					...input,
					authorizedProjectId: authorized.authorizedProjectId,
				});
				return;
			}
			const intent: AmendCompletedWorkIntent = {
				workPeriodId: input.period.id,
				clockIn: { kind: "preserve" },
				clockOut: { kind: "preserve" },
				project:
					input.projectId === undefined
						? { kind: "preserve" }
						: input.projectId
							? { kind: "replace", id: input.projectId }
							: { kind: "clear" },
				...namedTaskIntent(input.taskId),
				workCategory: { kind: "preserve" },
				workLocation: { kind: "preserve" },
				...(input.billable === undefined
					? {}
					: { billable: { kind: "set" as const, billable: input.billable } }),
				notes: null,
			};
			await amendCompletedWork(scope, {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				actorUserId: input.actorUserId,
				authority,
				writer: "work_period_attribution_edit",
				command: {
					version: AMEND_COMPLETED_WORK_COMMAND_VERSION,
					operationId: randomUUID(),
					request: {
						workPeriodId: input.period.id,
						...(input.projectId === undefined ? {} : { projectId: input.projectId }),
						// Absent unless named, keeping earlier receipts' shape.
						...namedTaskId(input.taskId),
						...(input.billable === undefined ? {} : { billable: String(input.billable) }),
					},
				},
				intent,
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

/**
 * An organization admin's billability-only change of one work period inside the
 * caller's coordinated scope (#901 bulk billability), with a caller-chosen
 * operation identity so a retry replays the committed receipt. Same path as a
 * single billability change: the `work_period_attribution_edit` writer and
 * receipt in adopted organizations, the legacy writer otherwise, both under the
 * `organization_admin` authority. Work with an unresolved review is refused in
 * both admissions. `unchanged` means the work already had this billability
 * (legacy; adopted organizations refuse a no-change amendment).
 */
export async function setWorkPeriodBillabilityAsAdmin(
	scope: SealedWorkTransactionScope,
	input: {
		organizationId: string;
		employeeId: string;
		actorUserId: string;
		period: PeriodSource;
		billable: boolean;
		operationId: string;
		/** Request evidence recorded on the receipt besides the period and billability. */
		evidence: Record<string, string>;
	},
): Promise<"executed" | "replayed" | "unchanged"> {
	const authority = "organization_admin" as const;
	if (scope.admission === "legacy") {
		await lockAuthority(scope.db, { ...input, authority, workPeriodId: input.period.id });
		const [period] = await scope.db
			.select({
				id: workPeriod.id,
				approvalStatus: workPeriod.approvalStatus,
				isBillable: workPeriod.isBillable,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, input.period.id),
					eq(workPeriod.organizationId, input.organizationId),
					eq(workPeriod.employeeId, input.employeeId),
					isNull(workPeriod.deletedAt),
				),
			)
			.for("update");
		if (!period) {
			throw new NotFoundError({
				message: "Work period not found",
				entityType: "workPeriod",
				entityId: input.period.id,
			});
		}
		await assertNoUnresolvedWorkPeriodReview(scope.db, input.organizationId, period);
		if (period.isBillable === input.billable) return "unchanged";
		await changeLegacyWorkPeriodProject(scope.db, {
			...input,
			authorizedProjectId: null,
		});
		return "executed";
	}
	const receipt = await replayOrAmendCompletedWork(scope, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		actorUserId: input.actorUserId,
		authority,
		writer: "work_period_attribution_edit",
		command: {
			version: AMEND_COMPLETED_WORK_COMMAND_VERSION,
			operationId: input.operationId,
			request: {
				...input.evidence,
				workPeriodId: input.period.id,
				billable: String(input.billable),
			},
		},
		intent: {
			workPeriodId: input.period.id,
			clockIn: { kind: "preserve" },
			clockOut: { kind: "preserve" },
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
			workLocation: { kind: "preserve" },
			billable: { kind: "set", billable: input.billable },
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
	return receipt.disposition;
}

/**
 * The legacy attribution change (#900): the period and its canonical record's
 * project allocation change together, so both representations keep agreeing on
 * project, task and billability. A changed project applies its billable default unless
 * the edit sets billability; the same project keeps the period's billability. The
 * task follows the period as it is now (#873), re-read under its row lock rather
 * than taken from the caller's earlier read; a newly booked task is re-checked.
 */
async function changeLegacyWorkPeriodProject(
	tx: SealedWorkTransactionScope["db"],
	input: {
		organizationId: string;
		employeeId: string;
		teamId?: string | null;
		period: { id: string };
		projectId?: string | null;
		taskId?: string | null;
		billable?: boolean;
		authorizedProjectId: string | null;
	},
): Promise<void> {
	const [period] = await tx
		.select({
			id: workPeriod.id,
			projectId: workPeriod.projectId,
			taskId: workPeriod.taskId,
			isBillable: workPeriod.isBillable,
			canonicalRecordId: workPeriod.canonicalRecordId,
			approvalStatus: workPeriod.approvalStatus,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.period.id),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				isNull(workPeriod.deletedAt),
			),
		)
		.for("update");
	if (!period) {
		throw new NotFoundError({
			message: "Work period not found",
			entityType: "workPeriod",
			entityId: input.period.id,
		});
	}
	// A project manager's authority holds only while the work is on their project.
	if (input.authorizedProjectId !== null && period.projectId !== input.authorizedProjectId) {
		throw new ConflictError({
			message: "Work period changed while editing",
			conflictType: "time_correction_work_period_stale",
		});
	}
	// Work under review keeps its facts, as in adopted organizations (#256).
	await assertNoUnresolvedWorkPeriodReview(tx, input.organizationId, period);
	// Attribution of work touching a closed month is frozen (#762).
	await assertWorkOpen(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		intervals: [workInterval(period.startTime, period.endTime)],
	});
	// Billability is changed after recording; live work gets it at clock-out.
	if (input.projectId === undefined && period.endTime === null) {
		throw new ConflictError({
			message: "Cannot edit an active work period. Please clock out first.",
			conflictType: "work_period_running",
		});
	}
	const projectId = input.projectId === undefined ? period.projectId : input.projectId;
	const { task } = namedTaskIntent(input.taskId);
	const taskId = taskIdFollowingProject({ task, projectId, current: period });
	if (task?.kind === "replace" && taskId) {
		const reason = await projectTaskIneligibility(
			{
				employeeId: input.employeeId,
				teamId: input.teamId ?? null,
				organizationId: input.organizationId,
			},
			{ projectId, taskId },
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
	const isBillable = await resolveWorkBillabilityInTransaction(tx, input.organizationId, {
		projectId,
		projectChosen: projectId !== period.projectId,
		current: period.isBillable,
		requested: input.billable,
	});
	await tx
		.update(workPeriod)
		.set({ projectId, taskId, isBillable, updatedAt: new Date() })
		.where(
			and(
				eq(workPeriod.id, input.period.id),
				eq(workPeriod.organizationId, input.organizationId),
				isNull(workPeriod.deletedAt),
			),
		);
	// Changed attribution sends a submitted period back to the employee (#1062).
	if (
		projectId !== period.projectId ||
		taskId !== period.taskId ||
		isBillable !== period.isBillable
	) {
		await sendBackChangedPeriodSubmissions(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			work: [workInterval(period.startTime, period.endTime)],
		});
	}
	if (!period.canonicalRecordId) return;
	await tx
		.delete(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.recordId, period.canonicalRecordId),
				eq(timeRecordAllocation.organizationId, input.organizationId),
				eq(timeRecordAllocation.allocationKind, "project"),
			),
		);
	if (projectId) {
		await tx.insert(timeRecordAllocation).values({
			organizationId: input.organizationId,
			recordId: period.canonicalRecordId,
			allocationKind: "project",
			projectId,
			taskId,
			weightPercent: 100,
			isBillable,
		});
	}
}
