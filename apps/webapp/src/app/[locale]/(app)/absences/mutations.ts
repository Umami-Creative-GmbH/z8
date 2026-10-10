"use server";

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	absenceEntry,
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	approvalWorkflow,
	employee,
	employeeManagers,
	timeRecord,
} from "@/db/schema";
import {
	legacyDeliveryCycleId,
	recordLegacyDeliveryIntent,
} from "@/lib/approvals/delivery/intents";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import { captureAbsenceLegacyApprovalState } from "@/lib/approvals/domain-adapters/absence-legacy-state";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import {
	deleteCancelledTimeCorrectionsInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
} from "@/lib/approvals/server/time-correction-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction } from "@/lib/approvals/server/work-period-approvals";
import { pinApprovalWriteGate } from "@/lib/approvals/workflow/pinned-write-gate";
import type { VerifiedLegacyApprovalState } from "@/lib/approvals/workflow/ports";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import {
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import {
	comparePlainDates,
	dateFromInstant,
	type PlainDate,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { onApprovedAbsenceCancelledByEmployee } from "@/lib/notifications/triggers";
import { deleteSickNotesOfCancelledAbsence } from "@/lib/personnel-file/sick-note-store";
import { deletePersonnelDocumentObject } from "@/lib/personnel-file/storage";
import { runPersonnelFileCleanup } from "@/lib/personnel-file/upload-ledger";
import { addCalendarSyncJob } from "@/lib/queue";
import { removeCanonicalAbsenceRecordInTransaction } from "./actions.canonical";
import { getCurrentEmployee } from "./current-employee";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { monthClosedMessage } from "@/lib/time-tracking/closed-months/refusal-message";
import { assertAbsenceOpenById } from "@/lib/time-tracking/closed-months/store";

export interface CancelAbsenceEmployeeContext {
	id: string;
	organizationId: string;
}

type AbsenceForCancellation = typeof absenceEntry.$inferSelect & {
	category?: { id: string; organizationId: string; name: string } | null;
	employee?: {
		id: string;
		organizationId: string;
		userId: string;
		user?: { id: string; name?: string | null } | null;
	} | null;
};

type ManagerLinkForNotification = {
	manager?: { userId?: string | null; organizationId?: string | null } | null;
};

class AbsenceCancellationError extends Error {
	constructor(readonly publicMessage: string) {
		super(publicMessage);
		this.name = "AbsenceCancellationError";
	}
}

function fail(message = "Failed to cancel absence"): never {
	throw new AbsenceCancellationError(message);
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
		const managerLinks = await db.query.employeeManagers.findMany({
			where: eq(employeeManagers.employeeId, absence.employeeId),
			with: { manager: true },
		});
		await Promise.allSettled(
			(managerLinks as ManagerLinkForNotification[]).flatMap((link) => {
				const managerUserId = link.manager?.userId;
				if (!managerUserId || link.manager?.organizationId !== organizationId) {
					return [];
				}
				return [
					onApprovedAbsenceCancelledByEmployee({
						absenceId: absence.id,
						managerUserId,
						employeeName: absence.employee?.user?.name ?? "An employee",
						organizationId,
						categoryName: absence.category?.name ?? "absence",
						startDate: absence.startDate,
						endDate: absence.endDate,
					}),
				];
			}),
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

async function deleteScopedAbsence(
	transactionDb: typeof db,
	input: {
		absence: AbsenceForCancellation;
		organizationId: string;
		expectedStatus: "pending" | "approved";
		expectedApprovalWorkflowId: string | null;
		expectedCanonicalRecordId: string;
		/** Who cancels: recorded on the deletion of the absence's sick notes. */
		actorUserId: string;
	},
): Promise<string[]> {
	// Cancelling an absence that touches a closed month is refused (#762). Its
	// days are read from the row: callers may hand over only its identity.
	await assertAbsenceOpenById(transactionDb, {
		organizationId: input.organizationId,
		absenceId: input.absence.id,
	});
	// Cancelling deletes the absence's sick notes in the same transaction (#982,
	// Personnel File ADR 0002), each audited; rejecting keeps them.
	const deletedSickNoteIds = await deleteSickNotesOfCancelledAbsence(transactionDb, {
		organizationId: input.organizationId,
		absenceId: input.absence.id,
		actorUserId: input.actorUserId,
	});
	const deleted = await transactionDb
		.delete(absenceEntry)
		.where(
			and(
				eq(absenceEntry.id, input.absence.id),
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.employeeId, input.absence.employeeId),
				eq(absenceEntry.status, input.expectedStatus),
				input.expectedApprovalWorkflowId === null
					? isNull(absenceEntry.approvalWorkflowId)
					: eq(
							absenceEntry.approvalWorkflowId,
							input.expectedApprovalWorkflowId,
						),
				eq(absenceEntry.canonicalRecordId, input.expectedCanonicalRecordId),
			),
		)
		.returning({
			id: absenceEntry.id,
			organizationId: absenceEntry.organizationId,
			employeeId: absenceEntry.employeeId,
			status: absenceEntry.status,
			approvalWorkflowId: absenceEntry.approvalWorkflowId,
			canonicalRecordId: absenceEntry.canonicalRecordId,
		});
	const row = deleted[0];
	if (
		deleted.length !== 1 ||
		row?.id !== input.absence.id ||
		row.organizationId !== input.organizationId ||
		row.employeeId !== input.absence.employeeId ||
		row.status !== input.expectedStatus ||
		row.approvalWorkflowId !== input.expectedApprovalWorkflowId ||
		row.canonicalRecordId !== input.expectedCanonicalRecordId
	) {
		fail("Absence changed before cancellation could complete");
	}
	await removeCanonicalAbsenceRecordInTransaction(transactionDb, {
		organizationId: input.organizationId,
		canonicalRecordId: input.expectedCanonicalRecordId,
		expectedEmployeeId: input.absence.employeeId,
		expectedApprovalState: input.expectedStatus,
	});
	return deletedSickNoteIds;
}

function assertExactIds(
	rows: Array<{ id: string }>,
	expectedIds: string[],
	message: string,
): void {
	const expected = new Set(expectedIds);
	const returnedIds = rows.map((row) => row.id);
	const returned = new Set(returnedIds);
	if (
		expected.size !== expectedIds.length ||
		returned.size !== returnedIds.length ||
		rows.length !== expectedIds.length ||
		returnedIds.some((id) => !expected.has(id))
	) {
		fail(message);
	}
}

async function cancelLegacyApprovalRows(
	dbService: ApprovalDbService,
	input: {
		organizationId: string;
		absenceId: string;
		requests: Array<typeof approvalRequest.$inferSelect>;
		chains: Array<
			typeof approvalChainInstance.$inferSelect & {
				stages?: Array<typeof approvalChainStageInstance.$inferSelect>;
			}
		>;
		cancelledAt: Date;
	},
): Promise<boolean> {
	// Each submission cycle is withdrawn with its absence (#384): a lifecycle
	// intent, written only while a delivery control exists, lets the delivery
	// owner refresh the cycle's sent cards. Its requests are read before the
	// pending ones are deleted and their chain links cleared.
	const cycles =
		input.chains.length === 0
			? input.requests.map((request) => ({
					cycleId: legacyDeliveryCycleId({
						chainInstanceId: null,
						approvalRequestId: request.id,
					}),
					requestId: request.id,
				}))
			: input.chains.flatMap((chain) => {
					const stage = (chain.stages ?? []).find((row) => row.approvalRequestId);
					return stage?.approvalRequestId
						? [
								{
									cycleId: legacyDeliveryCycleId({
										chainInstanceId: chain.id,
										approvalRequestId: stage.approvalRequestId,
									}),
									requestId: stage.approvalRequestId,
								},
							]
						: [];
				});
	let deliveryIntent = false;
	for (const cycle of cycles) {
		deliveryIntent =
			(await recordLegacyDeliveryIntent(dbService.db, {
				organizationId: input.organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId: input.absenceId,
				approvalRequestId: cycle.requestId,
				cycleId: cycle.cycleId,
				event: "withdrawn",
			})) || deliveryIntent;
	}
	const activeRequestIds = new Set(
		input.chains.flatMap((chain) =>
			(chain.stages ?? []).flatMap((stage) =>
				stage.status === "pending" && stage.approvalRequestId
					? [stage.approvalRequestId]
					: [],
			),
		),
	);
	const requestsToDelete =
		input.chains.length === 0
			? input.requests
			: input.requests.filter((request) => activeRequestIds.has(request.id));
	if (
		input.chains.length > 0 &&
		(requestsToDelete.length !== activeRequestIds.size ||
			requestsToDelete.some((request) => request.status !== "pending"))
	) {
		fail("Legacy approval request linkage is invalid");
	}
	const pendingStages = input.chains.flatMap((chain) =>
		(chain.stages ?? []).flatMap((stage) =>
			stage.status === "pending" ? [{ chainId: chain.id, stage }] : [],
		),
	);
	if (pendingStages.length > 0) {
		const updatedStages = await dbService.db
			.update(approvalChainStageInstance)
			.set({
				status: "cancelled",
				approvalRequestId: null,
				decidedBy: null,
				decidedAt: null,
			})
			.where(
				and(
					eq(approvalChainStageInstance.organizationId, input.organizationId),
					eq(approvalChainStageInstance.status, "pending"),
					or(
						...pendingStages.map(({ chainId, stage }) =>
							and(
								eq(approvalChainStageInstance.id, stage.id),
								eq(approvalChainStageInstance.chainInstanceId, chainId),
								stage.approvalRequestId === null
									? isNull(approvalChainStageInstance.approvalRequestId)
									: eq(
											approvalChainStageInstance.approvalRequestId,
											stage.approvalRequestId,
										),
							),
						),
					),
				),
			)
			.returning({ id: approvalChainStageInstance.id });
		assertExactIds(
			updatedStages,
			pendingStages.map(({ stage }) => stage.id),
			"Legacy approval stage changed during cancellation",
		);
	}

	if (input.chains.length > 0) {
		const updatedChains = await dbService.db
			.update(approvalChainInstance)
			.set({ status: "cancelled", completedAt: input.cancelledAt })
			.where(
				and(
					eq(approvalChainInstance.organizationId, input.organizationId),
					eq(approvalChainInstance.entityType, "absence_entry"),
					eq(approvalChainInstance.entityId, input.absenceId),
					or(
						...input.chains.map((chain) =>
							and(
								eq(approvalChainInstance.id, chain.id),
								eq(approvalChainInstance.status, chain.status),
							),
						),
					),
				),
			)
			.returning({ id: approvalChainInstance.id });
		assertExactIds(
			updatedChains,
			input.chains.map((chain) => chain.id),
			"Legacy approval chain changed during cancellation",
		);
	}

	if (requestsToDelete.length > 0) {
		const deletedRequests = await dbService.db
			.delete(approvalRequest)
			.where(
				and(
					eq(approvalRequest.organizationId, input.organizationId),
					eq(approvalRequest.entityType, "absence_entry"),
					eq(approvalRequest.entityId, input.absenceId),
					or(
						...requestsToDelete.map((request) =>
							and(
								eq(approvalRequest.id, request.id),
								eq(approvalRequest.status, request.status),
							),
						),
					),
				),
			)
			.returning({ id: approvalRequest.id });
		assertExactIds(
			deletedRequests,
			requestsToDelete.map((request) => request.id),
			"Legacy approval request changed during cancellation",
		);
	}
	return deliveryIntent;
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
	// Sick notes deleted with the absence, for an immediate cleanup attempt after commit.
	let deletedSickNoteIds: string[] = [];

	const runtime = createProductionApprovalWorkflowRuntime({
		db,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async () => {
					throw new Error(
						"Absence decision finalization is unavailable in cancellation",
					);
				},
				deleteCancelledAbsence: async (input) => {
					deletedSickNoteIds = await deleteScopedAbsence(
						input.dbService.db as typeof db,
						{
							absence: {
								id: input.absenceId,
								organizationId: input.organizationId,
								employeeId: input.expectedEmployeeId,
								status: input.expectedStatus,
							} as AbsenceForCancellation,
							organizationId: input.organizationId,
							expectedStatus: input.expectedStatus,
							expectedApprovalWorkflowId: input.expectedApprovalWorkflowId,
							expectedCanonicalRecordId: input.expectedCanonicalRecordId,
							actorUserId: currentEmployee.userId,
						},
					);
				},
			},
			timeCorrection: {
				clock: systemClock,
				finalizeTimeCorrectionTerminal:
					finalizeTimeCorrectionTerminalInTransaction,
				deleteCancelledCorrections: deleteCancelledTimeCorrectionsInTransaction,
			},
			ordinaryWorkPeriod: {
				finalizeTerminal:
					finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
			},
		},
		clock: systemClock,
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
		const committedCancellation = await runtime.repository.withTransaction(
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

				const absence = (await transactionDb.query.absenceEntry.findFirst({
					where: and(
						eq(absenceEntry.id, absenceId),
						eq(absenceEntry.organizationId, organizationId),
					),
					with: {
						category: true,
						employee: { with: { user: true } },
					},
				})) as AbsenceForCancellation | undefined;
				if (
					!absence ||
					absence.id !== absenceId ||
					absence.organizationId !== organizationId ||
					absence.category?.id !== absence.categoryId ||
					absence.category.organizationId !== organizationId ||
					absence.employee?.id !== absence.employeeId ||
					absence.employee.organizationId !== organizationId ||
					absence.employee.userId !== absence.employee.user?.id ||
					!absence.canonicalRecordId
				) {
					fail("Absence not found in the active organization");
				}

				const [
					ownedOrganization,
					canonicalRecord,
					workflowRow,
					requests,
					chains,
				] = await Promise.all([
					transactionDb.query.organization.findFirst({
						where: eq(organization.id, organizationId),
						columns: { id: true, timezone: true },
					}),
					transactionDb.query.timeRecord.findFirst({
						where: and(
							eq(timeRecord.id, absence.canonicalRecordId),
							eq(timeRecord.organizationId, organizationId),
							eq(timeRecord.employeeId, absence.employeeId),
							eq(timeRecord.recordKind, "absence"),
						),
					}),
					absence.approvalWorkflowId
						? transactionDb.query.approvalWorkflow.findFirst({
								where: and(
									eq(approvalWorkflow.id, absence.approvalWorkflowId),
									eq(approvalWorkflow.organizationId, organizationId),
									eq(approvalWorkflow.workflowType, "absence"),
									eq(approvalWorkflow.sourceType, "absence_entry"),
									eq(approvalWorkflow.sourceId, absenceId),
								),
							})
						: Promise.resolve(undefined),
					transactionDb.query.approvalRequest.findMany({
						where: and(
							eq(approvalRequest.organizationId, organizationId),
							eq(approvalRequest.entityType, "absence_entry"),
							eq(approvalRequest.entityId, absenceId),
						),
						limit: 1001,
					}),
					transactionDb.query.approvalChainInstance.findMany({
						where: and(
							eq(approvalChainInstance.organizationId, organizationId),
							eq(approvalChainInstance.entityType, "absence_entry"),
							eq(approvalChainInstance.entityId, absenceId),
						),
						with: { stages: true },
						limit: 2,
					}),
				]);
				if (
					ownedOrganization?.id !== organizationId ||
					!ownedOrganization.timezone ||
					canonicalRecord?.id !== absence.canonicalRecordId ||
					canonicalRecord.organizationId !== organizationId ||
					canonicalRecord.employeeId !== absence.employeeId ||
					canonicalRecord.recordKind !== "absence" ||
					canonicalRecord.approvalState !== absence.status ||
					(absence.approvalWorkflowId === null
						? workflowRow !== undefined
						: workflowRow?.id !== absence.approvalWorkflowId ||
							workflowRow.organizationId !== organizationId ||
							workflowRow.workflowType !== "absence" ||
							workflowRow.sourceType !== "absence_entry" ||
							workflowRow.sourceId !== absenceId) ||
					requests.length > 1000 ||
					chains.length > 1 ||
					requests.some(
						(request) =>
							request.organizationId !== organizationId ||
							request.entityType !== "absence_entry" ||
							request.entityId !== absenceId,
					) ||
					chains.some(
						(chain) =>
							chain.organizationId !== organizationId ||
							chain.entityType !== "absence_entry" ||
							chain.entityId !== absenceId ||
							chain.requesterEmployeeId !== absence.employeeId ||
							(chain.stages ?? []).some(
								(stage) =>
									stage.organizationId !== organizationId ||
									stage.chainInstanceId !== chain.id,
							),
					)
				) {
					fail();
				}

				let today: PlainDate;
				try {
					today = systemClock
						.nowInstant()
						.toZonedDateTimeISO(ownedOrganization.timezone)
						.toPlainDate();
				} catch {
					fail("Absence organization timezone is invalid");
				}
				const owner = transactionActor.id === absence.employeeId;
				if (absence.status !== "pending" && absence.status !== "approved") {
					fail("You do not have permission to cancel this absence");
				}
				const canCancel =
					(absence.status === "pending" &&
						(owner || transactionActor.role === "admin")) ||
					(absence.status === "approved" &&
						owner &&
						comparePlainDates(parsePlainDate(absence.startDate), today) > 0);
				if (!canCancel) {
					fail(
						absence.status === "approved" && owner
							? "Approved absences can only be cancelled before they start"
							: "You do not have permission to cancel this absence",
					);
				}

				const gate = await context.writeGate.acquire({
					organizationId,
					workflowType: "absence",
				});
				const pinnedContext: ApprovalWorkflowTransactionContext = {
					...context,
					writeGate: pinApprovalWriteGate({
						organizationId,
						workflowType: "absence",
						authority: gate,
						refuse: () => fail(),
					}),
				};
				const cancelledAt = systemClock.nowInstant();
				if (
					gate.shadowMirroring &&
					(!absence.approvalWorkflowId || !workflowRow)
				) {
					fail("Absence approval workflow link is missing");
				}

				if (gate.authority === "canonical") {
					if (!absence.approvalWorkflowId || !workflowRow) {
						fail("Absence approval workflow link is missing");
					}
					const snapshot = await context.repository.loadSnapshot({
						organizationId,
						workflowId: absence.approvalWorkflowId,
					});
					if (
						snapshot.id !== workflowRow.id ||
						snapshot.organizationId !== organizationId ||
						snapshot.workflowType !== "absence" ||
						snapshot.sourceType !== "absence_entry" ||
						snapshot.sourceId !== absenceId ||
						snapshot.status !== absence.status ||
						snapshot.version !== workflowRow.version
					) {
						fail("Absence approval workflow link is mismatched");
					}
					const execution =
						await runtime.transitionEngine.executeInTransactionWithDisposition(
							pinnedContext,
							{
								organizationId,
								workflowId: snapshot.id,
								expectedVersion: snapshot.version,
								idempotencyKey: `absence:${organizationId}:${snapshot.id}:cancel:${snapshot.version}`,
								principal: {
									kind: "employee",
									userId: transactionActor.userId,
								},
								command: { type: "cancel", reason: "Absence cancelled" },
							},
						);
					return { absence, disposition: execution.disposition };
				}

				let before: VerifiedLegacyApprovalState | undefined;
				if (gate.shadowMirroring) {
					before = await captureAbsenceLegacyApprovalState({
						dbService: pinnedContext.dbService,
						organizationId,
						absenceId,
						capturedAt: cancelledAt,
					});
				}
				const deliveryIntent = await cancelLegacyApprovalRows(
					{
						db: transactionDb,
						query: <T>(_name: string, operation: () => Promise<T>) =>
							Effect.promise(operation),
					},
					{
						organizationId,
						absenceId,
						requests,
						chains,
						cancelledAt: dateFromInstant(cancelledAt),
					},
				);
				if (before) {
					const after = await captureAbsenceLegacyApprovalState({
						dbService: pinnedContext.dbService,
						organizationId,
						absenceId,
						capturedAt: cancelledAt,
					});
					const mirrored =
						await pinnedContext.compatibilityWriter.mirrorLegacyToCanonical({
							before,
							after,
							actor: {
								kind: "employee",
								employeeId: transactionActor.id,
								userId: transactionActor.userId,
							},
							idempotencyKey: `absence:${organizationId}:${absenceId}:cancel:${workflowRow?.version ?? "initial"}`,
							expectedVersion: workflowRow?.version ?? null,
						});
					if (
						mirrored === null ||
						mirrored.snapshot.id !== absence.approvalWorkflowId ||
						mirrored.snapshot.organizationId !== organizationId ||
						mirrored.snapshot.workflowType !== "absence" ||
						mirrored.snapshot.sourceType !== "absence_entry" ||
						mirrored.snapshot.sourceId !== absenceId ||
						mirrored.snapshot.status !== "cancelled"
					) {
						fail("Observed absence cancellation workflow is mismatched");
					}
				}
				deletedSickNoteIds = await deleteScopedAbsence(transactionDb, {
					absence,
					organizationId,
					expectedStatus: absence.status,
					expectedApprovalWorkflowId: absence.approvalWorkflowId,
					expectedCanonicalRecordId: absence.canonicalRecordId,
					actorUserId: transactionActor.userId,
				});
				return { absence, disposition: "executed" as const, deliveryIntent };
			},
		);

		if (committedCancellation.disposition === "replayed") {
			return { success: true };
		}
		if ("deliveryIntent" in committedCancellation && committedCancellation.deliveryIntent) {
			// The withdrawal intent committed; this only runs the owner sooner.
			kickApprovalDelivery({ organizationId });
		}
		const committedAbsence = committedCancellation.absence;
		await cleanUpDeletedSickNotes(organizationId, deletedSickNoteIds);
		await addCalendarSyncJob({
			absenceId,
			employeeId: committedAbsence.employeeId,
			organizationId,
			action: "delete",
		}).catch(() => undefined);
		if (
			committedAbsence.status === "approved" &&
			committedAbsence.employeeId === currentEmployee.id
		) {
			await notifyManagersOfApprovedSelfCancellation(
				committedAbsence,
				organizationId,
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
