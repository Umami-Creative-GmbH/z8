"use server";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { notifyAbsenceDeputies } from "@/lib/absences/deputy-notifier";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import {
	isBillingMutationAllowed,
	requireBillingForMutation
} from "@/lib/billing/guard";
import { currentRosterManagerRecipients } from "@/lib/notifications/manager-notice-recipients";
import { onApprovedAbsenceCancelledByEmployee } from "@/lib/notifications/triggers";
import { deletePersonnelDocumentObject } from "@/lib/personnel-file/storage";
import { runPersonnelFileCleanup } from "@/lib/personnel-file/upload-ledger";
import { addCalendarSyncJob } from "@/lib/queue";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { monthClosedMessage } from "@/lib/time-tracking/closed-months/refusal-message";
import {
	AbsenceCancellationError,
	type AbsenceForCancellation,
	cancelAbsenceInTransaction,
	createAbsenceCancellationRuntime,
	failAbsenceCancellation as fail,
} from "./cancel-absence-core";
import { getCurrentEmployee } from "./current-employee";

export interface CancelAbsenceEmployeeContext {
	id: string;
	organizationId: string;
}

function resultRows(value: unknown): unknown[] {
	return typeof value === "object" &&
		value !== null &&
		"rows" in value &&
		Array.isArray(value.rows)
		? value.rows
		: [];
}

async function notifyManagersOfApprovedSelfCancellation(
	absence: AbsenceForCancellation,
	organizationId: string,
): Promise<void> {
	try {
		// Informational: the absence is already cancelled and nothing waits on the
		// managers, so with no current manager left it is dropped (#1438).
		const recipients = await currentRosterManagerRecipients(db, {
			organizationId,
			employeeIds: [absence.employeeId],
			notice: "informational",
		});
		await Promise.allSettled(
			recipients.userIds.map((managerUserId) =>
				onApprovedAbsenceCancelledByEmployee({
					absenceId: absence.id,
					managerUserId,
					employeeName: absence.employee?.user?.name ?? "An employee",
					organizationId,
					categoryName: absence.category?.name ?? "absence",
					startDate: absence.startDate,
					endDate: absence.endDate,
				}),
			),
		);
	} catch {
		// Cancellation remains successful if post-commit notification delivery fails.
	}
}

/**
 * Tries to delete the stored objects of the sick notes a cancellation removed.
 * They are queued durably already, so a failure only defers it.
 */
async function cleanUpDeletedSickNotes(
	organizationId: string,
	documentIds: readonly string[],
): Promise<void> {
	for (const documentId of documentIds) {
		await runPersonnelFileCleanup(db, {
			deleteObject: deletePersonnelDocumentObject,
			only: { documentId, organizationId },
		}).catch(() => undefined);
	}
}

export async function cancelAbsenceRequest(
	absenceId: string,
): Promise<{ success: boolean; error?: string }> {
	return cancelAbsenceRequestForEmployee(absenceId);
}

export async function cancelAbsenceRequestForEmployee(
	absenceId: string,
	expectedEmployeeContext?: CancelAbsenceEmployeeContext,
): Promise<{ success: boolean; error?: string }> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}
	if (
		expectedEmployeeContext &&
		(expectedEmployeeContext.id !== currentEmployee.id ||
			expectedEmployeeContext.organizationId !== currentEmployee.organizationId)
	) {
		return {
			success: false,
			error: "Employee profile does not match the authenticated session",
		};
	}
	const organizationId = currentEmployee.organizationId;
	const billingAccess = await requireBillingForMutation(organizationId);
	if (!isBillingMutationAllowed(billingAccess)) {
		return { success: false, error: "billing_required" };
	}

	const cancellation = createAbsenceCancellationRuntime({
		db,
		actor: {
			kind: "employee",
			employeeId: currentEmployee.id,
			userId: currentEmployee.userId,
		},
		canManageApproval: async (input) => {
			if (input.command.type !== "cancel") return false;
			const actors = resultRows(
				await input.dbService.db.execute(sql`
					select id, organization_id, role
					from employee
					where id = ${input.actorEmployeeId}::uuid
						and organization_id = ${input.organizationId}
						and is_active = true
					limit 2
				`),
			);
			const actor = actors[0] as Record<string, unknown> | undefined;
			return (
				actors.length === 1 &&
				actor?.id === input.actorEmployeeId &&
				actor.organization_id === input.organizationId &&
				actor.role === "admin"
			);
		},
	});

	try {
		const committedCancellation = await cancellation.runtime.repository.withTransaction(
			async (context) => {
				const transactionDb = context.dbService.db as typeof db;
				const transactionActors = await transactionDb.query.employee.findMany({
					where: and(
						eq(employee.id, currentEmployee.id),
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
					),
					with: { user: true },
					limit: 2,
				});
				const transactionActor = transactionActors[0];
				if (
					transactionActors.length !== 1 ||
					!transactionActor ||
					transactionActor.id !== currentEmployee.id ||
					transactionActor.organizationId !== organizationId ||
					transactionActor.isActive !== true ||
					!transactionActor.userId ||
					transactionActor.user?.id !== transactionActor.userId
				) {
					fail("Employee profile not found");
				}

				return cancelAbsenceInTransaction(cancellation, context, {
					organizationId,
					absenceId,
					actor: {
						kind: "employee",
						employeeId: transactionActor.id,
						userId: transactionActor.userId,
					},
					authorize: (absence) => {
						const owner = transactionActor.id === absence.employeeId;
						const canCancel =
							absence.status === "pending" &&
							(owner || transactionActor.role === "admin");
						if (!canCancel) {
							fail(
								absence.status === "approved" && owner
									? "Approved absences require a cancellation request"
									: "You do not have permission to cancel this absence",
							);
						}
					},
				});
			}
		);

		if (committedCancellation.disposition === "replayed") {
			return { success: true };
		}
		if (committedCancellation.deliveryIntent) {
			// The withdrawal intent committed; this only runs the owner sooner.
			kickApprovalDelivery({ organizationId });
		}
		const committedAbsence = committedCancellation.absence;
		await cleanUpDeletedSickNotes(organizationId, cancellation.deletedSickNoteIds());
		await addCalendarSyncJob({
			absenceId,
			employeeId: committedAbsence.employeeId,
			organizationId,
			action: "delete",
		}).catch(() => undefined);
		await notifyAbsenceDeputies(db, {
			organizationId,
			events: [
				{
					kind: "cancelled",
					absence: {
						id: committedAbsence.id,
						employeeId: committedAbsence.employeeId,
						deputyEmployeeId: committedAbsence.deputyEmployeeId,
						startDate: committedAbsence.startDate,
						endDate: committedAbsence.endDate,
						status: committedAbsence.status,
					},
				},
			],
		});
		if (
			committedAbsence.status === "approved" &&
			committedAbsence.employeeId === currentEmployee.id
		) {
			await notifyManagersOfApprovedSelfCancellation(
				committedAbsence,
				organizationId
			);
		}
		return { success: true };
	} catch (error) {
		const closed = monthClosedRefusalOf(error);
		if (closed) return { success: false, error: await monthClosedMessage(closed.month) };
		return {
			success: false,
			error:
				error instanceof AbsenceCancellationError
					? error.publicMessage
					: "Failed to cancel absence",
		};
	}
}
