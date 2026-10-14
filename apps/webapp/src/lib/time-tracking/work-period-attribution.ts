import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { NotFoundError } from "@/lib/effect/errors";
import {
	AMEND_COMPLETED_WORK_COMMAND_VERSION,
	type AmendCompletedWorkInput,
	type AmendmentAuthority,
	amendCompletedWork,
	amendLegacyCompletedWork,
	replayOrAmendCompletedWork,
} from "./amend-completed-work";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import { namedTaskId, namedTaskIntent } from "./task-attribution";
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
 * Standalone project change of the owner's own work period (#286). It runs the
 * completed-work amendment in both admissions: eligibility is re-checked under
 * the locks, and work records changes the period, the canonical project
 * allocation and the work revision together with the effects (#1225); adopted
 * organizations also commit a receipt.
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

/** The amendment of the scope's admission: with a receipt in append admission. */
function amendmentOf(scope: SealedWorkTransactionScope) {
	return scope.admission === "append" ? amendCompletedWork : amendLegacyCompletedWork;
}

function expectedSourceOf(period: PeriodSource): AmendCompletedWorkInput["expectedSource"] {
	return {
		clockInId: period.clockInId,
		clockOutId: period.clockOutId,
		startAt: instantFromDate(period.startTime),
		endAt: period.endTime ? instantFromDate(period.endTime) : null,
	};
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
			await amendmentOf(scope)(scope, {
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
				intent: {
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
				},
				expectedSource: expectedSourceOf(input.period),
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
 * single billability change: the `work_period_attribution_edit` writer through
 * work records in both admissions, with a receipt in adopted organizations, under
 * the `organization_admin` authority. Work with an unresolved review is refused in
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
	const amendment: AmendCompletedWorkInput = {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		actorUserId: input.actorUserId,
		authority: "organization_admin",
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
		expectedSource: expectedSourceOf(input.period),
		evaluatedAt: systemClock.nowInstant(),
		request: { ipAddress: null, deviceInfo: null },
	};
	if (scope.admission === "append") {
		return (await replayOrAmendCompletedWork(scope, amendment)).disposition;
	}
	// Legacy admission has no receipt to replay: work already at the billability is unchanged.
	const [period] = await scope.db
		.select({ isBillable: workPeriod.isBillable })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.period.id),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	if (!period) {
		throw new NotFoundError({
			message: "Work period not found",
			entityType: "workPeriod",
			entityId: input.period.id,
		});
	}
	if (period.isBillable === input.billable) return "unchanged";
	await amendLegacyCompletedWork(scope, amendment);
	return "executed";
}
