import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { timeRecordAllocation, workPeriod } from "@/db/schema";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError } from "@/lib/effect/errors";
import {
	AMEND_COMPLETED_WORK_COMMAND_VERSION,
	type AmendCompletedWorkIntent,
	type AmendmentAuthority,
	amendCompletedWork,
	lockAuthority,
	replayOrAmendCompletedWork,
} from "./amend-completed-work";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
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
	actorUserId: string;
	period: PeriodSource;
	/** Absent keeps the project; null clears it. */
	projectId?: string | null;
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
 */
export async function changeWorkPeriodProject(
	input: Omit<AttributionChange, "projectId"> & { projectId: string | null },
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
	input: Omit<AttributionChange, "projectId" | "billable"> & { billable: boolean },
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
 * project and billability. A changed project applies its billable default unless
 * the edit sets billability; the same project keeps the period's billability.
 */
async function changeLegacyWorkPeriodProject(
	tx: SealedWorkTransactionScope["db"],
	input: {
		organizationId: string;
		employeeId: string;
		period: { id: string };
		projectId?: string | null;
		billable?: boolean;
		authorizedProjectId: string | null;
	},
): Promise<void> {
	const [period] = await tx
		.select({
			projectId: workPeriod.projectId,
			isBillable: workPeriod.isBillable,
			canonicalRecordId: workPeriod.canonicalRecordId,
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
	const projectId = input.projectId === undefined ? period.projectId : input.projectId;
	const isBillable = await resolveWorkBillabilityInTransaction(tx, input.organizationId, {
		projectId,
		projectChosen: projectId !== period.projectId,
		current: period.isBillable,
		requested: input.billable,
	});
	await tx
		.update(workPeriod)
		.set({ projectId, isBillable, updatedAt: new Date() })
		.where(
			and(
				eq(workPeriod.id, input.period.id),
				eq(workPeriod.organizationId, input.organizationId),
				isNull(workPeriod.deletedAt),
			),
		);
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
			weightPercent: 100,
			isBillable,
		});
	}
}
