import { and, asc, eq, gte, inArray } from "drizzle-orm";
import {
	type CancelledAbsence,
	cancelAbsenceInTransaction,
	createAbsenceCancellationRuntime,
	failAbsenceCancellation,
} from "@/app/[locale]/(app)/absences/cancel-absence-core";
import { db } from "@/db";
import { absenceCategory, absenceEntry } from "@/db/schema";
import { notifyAbsenceDeputies } from "@/lib/absences/deputy-notifier";
import { acquireApprovalWriteLock } from "@/lib/approvals/authority/gate";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import type { ApprovalDbService } from "@/lib/approvals/workflow/ports";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { AuditAction } from "@/lib/audit-logger";
import {
	type Clock,
	comparePlainDates,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { deletePersonnelDocumentObject } from "@/lib/personnel-file/storage";
import { runPersonnelFileCleanup } from "@/lib/personnel-file/upload-ledger";
import { addCalendarSyncJob } from "@/lib/queue";
import { acquireOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction/ranks";
import {
	type AbsencePlanItem,
	type AbsencesApplied,
	type AbsencesPlan,
	type AreaApplyResult,
	type DeactivationApplyContext,
	type DeactivationPlanContext,
	type DeactivationReader,
	type DeactivationWriter,
	deactivationAuditMetadata,
} from "./types";

/**
 * The day they left: the deactivation instant as a calendar date in the
 * organization's zone, like `employee_left_on` (#1439). Absences are dated, so
 * one starting on that day spans the moment they left.
 */
export function deactivationLeftOn(
	ctx: Pick<DeactivationPlanContext, "at" | "organizationTimeZone">,
) {
	return ctx.at.toZonedDateTimeISO(ctx.organizationTimeZone).toPlainDate();
}

/**
 * The person's pending and approved absences that start after the day they
 * left (cancelled) and that span it (kept, listed). Ended absences are not
 * touched and not listed.
 */
export async function planAbsences(
	reader: DeactivationReader,
	ctx: DeactivationPlanContext,
): Promise<AbsencesPlan> {
	const leftOn = deactivationLeftOn(ctx);
	const rows = await reader
		.select({
			absenceId: absenceEntry.id,
			categoryName: absenceCategory.name,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
			status: absenceEntry.status,
		})
		.from(absenceEntry)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, absenceEntry.organizationId),
			),
		)
		.where(
			and(
				eq(absenceEntry.organizationId, ctx.organizationId),
				eq(absenceEntry.employeeId, ctx.employeeId),
				inArray(absenceEntry.status, ["pending", "approved"]),
				gte(absenceEntry.endDate, leftOn.toString()),
			),
		)
		.orderBy(asc(absenceEntry.startDate), asc(absenceEntry.id));
	const plan: AbsencesPlan = { absencesToCancel: [], absencesSpanning: [] };
	for (const row of rows) {
		if (row.status !== "pending" && row.status !== "approved") continue;
		const item: AbsencePlanItem = { ...row, status: row.status };
		if (startsAfter(item.startDate, leftOn)) plan.absencesToCancel.push(item);
		else plan.absencesSpanning.push(item);
	}
	return plan;
}

/**
 * The shared guards the in-transaction cancellation takes, held from the start of the
 * deactivation transaction so the acquisition protocol's rank order holds (#477; Rank in
 * `work-transaction/ranks.ts`): the approval write gates of absences and of period submissions
 * (rank 2; a cancelled absence can withdraw a submitted period) and the organization
 * configuration guard (rank 3; the closed-month check). Call it before the authorization guards
 * (rank 4) and the organization row lock. Taken later, they would wait on a writer that holds
 * them exclusively (a cutover, a month close, an organization-wide authorization or timezone
 * change) while that writer waits on the deactivation's user guard or organization row. The
 * cancellation re-takes them; a transaction never waits on a lock it holds.
 */
export async function acquireAbsenceCancellationGuards(
	tx: DeactivationWriter,
	organizationId: string,
): Promise<void> {
	const dbService = { db: tx as unknown as ApprovalDbService["db"] };
	await acquireApprovalWriteLock(dbService, { organizationId, workflowType: "absence" });
	await acquireApprovalWriteLock(dbService, {
		organizationId,
		workflowType: "period_submission",
	});
	await acquireOrganizationConfigurationGuard(tx, organizationId);
}

/**
 * Cancels the planned absences inside the deactivation transaction, through the normal
 * cancellation path (`cancel-absence-core.ts`) with the deactivation's narrow system capability.
 * Deleting an absence and its canonical record restores the allowance, since balances are
 * derived from the rows. Each cancellation is audited under the acting admin.
 *
 * Preconditions, owned by the deactivation transaction:
 * - the employee is already switched off with `employee.deactivated_at = ctx.at` (the
 *   capability's authorization re-reads it);
 * - the absences are cancelled before the person's team membership ends, because the absence
 *   adapter trusts a primary team only with its membership row;
 * - `acquireAbsenceCancellationGuards` ran at the start of the transaction, before the
 *   authorization guards and the organization row lock (lock order, see there).
 *
 * An absence that is no longer pending or approved (cancelled or rejected meanwhile) is skipped;
 * any other refusal (a closed month, a changed linkage) fails the deactivation.
 */
export async function applyAbsenceCancellations(
	tx: DeactivationWriter,
	plan: AbsencesPlan,
	ctx: DeactivationApplyContext,
	dependencies: { clock?: Clock } = {},
): Promise<AreaApplyResult<AbsencesApplied>> {
	const leftOn = deactivationLeftOn(ctx);
	const cancelledAbsenceIds: string[] = [];
	const committed: Array<{ cancelled: CancelledAbsence; deletedSickNoteIds: string[] }> = [];
	for (const item of plan.absencesToCancel) {
		const [current] = await tx
			.select({ status: absenceEntry.status })
			.from(absenceEntry)
			.where(
				and(
					eq(absenceEntry.organizationId, ctx.organizationId),
					eq(absenceEntry.employeeId, ctx.employeeId),
					eq(absenceEntry.id, item.absenceId),
					inArray(absenceEntry.status, ["pending", "approved"]),
				),
			)
			.limit(1);
		if (!current) continue;
		const actor = { kind: "employee_deactivation", actorUserId: ctx.actorUserId } as const;
		const cancellation = createAbsenceCancellationRuntime({
			db: tx as unknown as ApprovalWorkflowDatabase,
			actor,
			// The capability is the only grant; no employee manages anything here.
			canManageApproval: async () => false,
			clock: dependencies.clock,
		});
		const cancelled = await cancellation.runtime.repository.withTransaction((context) =>
			cancelAbsenceInTransaction(cancellation, context, {
				organizationId: ctx.organizationId,
				absenceId: item.absenceId,
				actor,
				clock: dependencies.clock,
				authorize: (absence) => {
					if (absence.employeeId !== ctx.employeeId || !startsAfter(absence.startDate, leftOn)) {
						failAbsenceCancellation("The absence does not start after the employee left");
					}
				},
			}),
		);
		await ctx.audit.record(tx, {
			organizationId: ctx.organizationId,
			action: AuditAction.ABSENCE_CANCELLED,
			actorUserId: ctx.actorUserId,
			targetType: "absence",
			targetId: item.absenceId,
			employeeId: ctx.employeeId,
			changes: { status: { from: cancelled.absence.status, to: "cancelled" } },
			metadata: {
				...deactivationAuditMetadata(ctx),
				startDate: cancelled.absence.startDate,
				endDate: cancelled.absence.endDate,
			},
		});
		cancelledAbsenceIds.push(item.absenceId);
		committed.push({ cancelled, deletedSickNoteIds: cancellation.deletedSickNoteIds() });
	}
	return {
		applied: { cancelledAbsenceIds },
		afterCommit:
			committed.length === 0 ? [] : [() => afterAbsencesCancelled(ctx.organizationId, committed)],
	};
}

/** What the employee's own cancellation does after its commit, minus the self-service notice. */
async function afterAbsencesCancelled(
	organizationId: string,
	committed: Array<{ cancelled: CancelledAbsence; deletedSickNoteIds: string[] }>,
): Promise<void> {
	if (committed.some(({ cancelled }) => cancelled.deliveryIntent)) {
		kickApprovalDelivery({ organizationId });
	}
	for (const { cancelled, deletedSickNoteIds } of committed) {
		for (const documentId of deletedSickNoteIds) {
			await runPersonnelFileCleanup(db, {
				deleteObject: deletePersonnelDocumentObject,
				only: { documentId, organizationId },
			}).catch(() => undefined);
		}
		await addCalendarSyncJob({
			absenceId: cancelled.absence.id,
			employeeId: cancelled.absence.employeeId,
			organizationId,
			action: "delete",
		}).catch(() => undefined);
	}
	await notifyAbsenceDeputies(db, {
		organizationId,
		events: committed.map(({ cancelled: { absence } }) => ({
			kind: "cancelled" as const,
			absence: {
				id: absence.id,
				employeeId: absence.employeeId,
				deputyEmployeeId: absence.deputyEmployeeId,
				startDate: absence.startDate,
				endDate: absence.endDate,
				status: absence.status,
			},
		})),
	}).catch(() => undefined);
}

function startsAfter(startDate: string, leftOn: PlainDate): boolean {
	return comparePlainDates(parsePlainDate(startDate), leftOn) > 0;
}
