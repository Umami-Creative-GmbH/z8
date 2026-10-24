import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	absenceEntry,
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	approvalWorkflow,
	timeRecord,
} from "@/db/schema";
import {
	legacyDeliveryCycleId,
	recordLegacyDeliveryIntent,
} from "@/lib/approvals/delivery/intents";
import { captureAbsenceLegacyApprovalState } from "@/lib/approvals/domain-adapters/absence-legacy-state";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import {
	deleteCancelledTimeCorrectionsInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
} from "@/lib/approvals/server/time-correction-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction } from "@/lib/approvals/server/work-period-approvals";
import { pinApprovalWriteGate } from "@/lib/approvals/workflow/pinned-write-gate";
import {
	type ApprovalEventActorIdentity,
	type ApprovalWorkflowPrincipal,
	EMPLOYEE_DEACTIVATION_CANCEL_REASON,
	EMPLOYEE_DEACTIVATION_SYSTEM_ID,
	type VerifiedLegacyApprovalState,
} from "@/lib/approvals/workflow/ports";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import { type Clock, dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { deleteSickNotesOfCancelledAbsence } from "@/lib/personnel-file/sick-note-store";
import { assertAbsenceOpenById } from "@/lib/time-tracking/closed-months/store";
import { sendBackChangedPeriodSubmissions } from "@/lib/time-tracking/period-submissions/submission-send-back";
import { removeCanonicalAbsenceRecordInTransaction } from "./actions.canonical";

/**
 * The transaction-scoped core of cancelling an absence (#1440): the normal cancellation path
 * that the employee's own cancellation and the employee deactivation share. The caller owns the
 * transaction (`cancellation.runtime.repository.withTransaction`; on a caller's drizzle
 * transaction that is a savepoint) and decides who may cancel through `authorize`. The core
 * verifies the absence's linkage, takes the approval write gate, and cancels through the
 * approval engine (canonical authority) or the legacy rows; either way the absence's sick notes,
 * its row and its canonical record are deleted, so the allowance is restored, and a submitted
 * period it touches is sent back. Everything after the commit (delivery kick, calendar, deputy
 * and manager notices, sick note object cleanup) stays with the caller.
 */

type AbsenceDatabase = typeof db;

export type AbsenceForCancellation = typeof absenceEntry.$inferSelect & {
	category?: { id: string; organizationId: string; name: string } | null;
	employee?: {
		id: string;
		organizationId: string;
		userId: string;
		user?: { id: string; name?: string | null } | null;
	} | null;
};

export class AbsenceCancellationError extends Error {
	constructor(readonly publicMessage: string) {
		super(publicMessage);
		this.name = "AbsenceCancellationError";
	}
}

export function failAbsenceCancellation(message = "Failed to cancel absence"): never {
	throw new AbsenceCancellationError(message);
}

function fail(message?: string): never {
	throw new AbsenceCancellationError(message ?? "Failed to cancel absence");
}

/** Who cancels: the absence's employee (or an admin) themselves, or a deactivation. */
export type AbsenceCancellationActor =
	| { kind: "employee"; employeeId: string; userId: string }
	| {
			kind: "employee_deactivation";
			/** The acting admin, recorded on what the cancellation deletes and sends back. */
			actorUserId: string;
	  };

function actorUserIdOf(actor: AbsenceCancellationActor): string {
	return actor.kind === "employee" ? actor.userId : actor.actorUserId;
}

export async function deleteScopedAbsence(
	transactionDb: AbsenceDatabase,
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
					: eq(absenceEntry.approvalWorkflowId, input.expectedApprovalWorkflowId),
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
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
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
	// A cancelled absence in a submitted period sends it back to the employee (#1062).
	await sendBackChangedPeriodSubmissions(transactionDb, {
		organizationId: input.organizationId,
		employeeId: row.employeeId,
		causedByUserId: input.actorUserId,
		days: [{ startDate: row.startDate, endDate: row.endDate }],
	});
	await removeCanonicalAbsenceRecordInTransaction(transactionDb, {
		organizationId: input.organizationId,
		canonicalRecordId: input.expectedCanonicalRecordId,
		expectedEmployeeId: input.absence.employeeId,
		expectedApprovalState: input.expectedStatus,
	});
	return deletedSickNoteIds;
}

function assertExactIds(rows: Array<{ id: string }>, expectedIds: string[], message: string): void {
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
				stage.status === "pending" && stage.approvalRequestId ? [stage.approvalRequestId] : [],
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
									: eq(approvalChainStageInstance.approvalRequestId, stage.approvalRequestId),
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
							and(eq(approvalRequest.id, request.id), eq(approvalRequest.status, request.status)),
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

type ApprovalRuntime = ReturnType<typeof createProductionApprovalWorkflowRuntime>;
type CanManageApproval = Parameters<
	typeof createProductionApprovalWorkflowRuntime
>[0]["canManageApproval"];

/** The approval runtime of one cancellation, and the sick notes it deleted. */
export interface AbsenceCancellationRuntime {
	runtime: ApprovalRuntime;
	/** Sick notes deleted with the absence, for a cleanup attempt after the commit. */
	deletedSickNoteIds(): string[];
	/** The legacy path deletes outside the approval adapter and records here. */
	recordDeletedSickNotes(ids: string[]): void;
}

export function createAbsenceCancellationRuntime(input: {
	/** The application database, or a caller's transaction (the runtime then nests in it). */
	db: AbsenceDatabase | ApprovalWorkflowDatabase;
	actor: AbsenceCancellationActor;
	canManageApproval: CanManageApproval;
	clock?: Clock;
}): AbsenceCancellationRuntime {
	const clock = input.clock ?? systemClock;
	let deletedSickNoteIds: string[] = [];
	const runtime = createProductionApprovalWorkflowRuntime({
		db: input.db as AbsenceDatabase,
		adapters: {
			absence: {
				clock,
				finalizeAbsenceTerminal: async () => {
					throw new Error("Absence decision finalization is unavailable in cancellation");
				},
				deleteCancelledAbsence: async (deletion) => {
					deletedSickNoteIds = await deleteScopedAbsence(deletion.dbService.db as AbsenceDatabase, {
						absence: {
							id: deletion.absenceId,
							organizationId: deletion.organizationId,
							employeeId: deletion.expectedEmployeeId,
							status: deletion.expectedStatus,
						} as AbsenceForCancellation,
						organizationId: deletion.organizationId,
						expectedStatus: deletion.expectedStatus,
						expectedApprovalWorkflowId: deletion.expectedApprovalWorkflowId,
						expectedCanonicalRecordId: deletion.expectedCanonicalRecordId,
						actorUserId: actorUserIdOf(input.actor),
					});
				},
			},
			timeCorrection: {
				clock,
				finalizeTimeCorrectionTerminal: finalizeTimeCorrectionTerminalInTransaction,
				deleteCancelledCorrections: deleteCancelledTimeCorrectionsInTransaction,
			},
			ordinaryWorkPeriod: {
				finalizeTerminal: finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
			},
		},
		clock,
		canManageApproval: input.canManageApproval,
	});
	return {
		runtime,
		deletedSickNoteIds: () => deletedSickNoteIds,
		recordDeletedSickNotes: (ids) => {
			deletedSickNoteIds = ids;
		},
	};
}

export type CancelledAbsence = {
	absence: AbsenceForCancellation;
	disposition: "executed" | "replayed";
	/** A legacy withdrawal intent committed with it; kick delivery after the commit. */
	deliveryIntent: boolean;
};

function canonicalCommand(
	actor: AbsenceCancellationActor,
	input: { organizationId: string; workflowId: string; version: number },
): {
	principal: ApprovalWorkflowPrincipal;
	idempotencyKey: string;
	reason: string;
} {
	if (actor.kind === "employee") {
		return {
			principal: { kind: "employee", userId: actor.userId },
			idempotencyKey: `absence:${input.organizationId}:${input.workflowId}:cancel:${input.version}`,
			reason: "Absence cancelled",
		};
	}
	return {
		principal: { kind: "system", systemId: EMPLOYEE_DEACTIVATION_SYSTEM_ID },
		idempotencyKey: `absence:${input.organizationId}:${input.workflowId}:deactivation-cancel:${input.version}`,
		reason: EMPLOYEE_DEACTIVATION_CANCEL_REASON,
	};
}

function mirrorActor(actor: AbsenceCancellationActor): ApprovalEventActorIdentity {
	return actor.kind === "employee"
		? { kind: "employee", employeeId: actor.employeeId, userId: actor.userId }
		: { kind: "system", employeeId: null, userId: null };
}

/**
 * Cancels one absence inside `context`, the approval transaction of `cancellation.runtime`.
 * `authorize` runs once the absence and its linkage are verified and throws when the actor may
 * not cancel it.
 */
export async function cancelAbsenceInTransaction(
	cancellation: AbsenceCancellationRuntime,
	context: ApprovalWorkflowTransactionContext,
	input: {
		organizationId: string;
		absenceId: string;
		actor: AbsenceCancellationActor;
		authorize: (absence: AbsenceForCancellation & { status: "pending" | "approved" }) => void;
		clock?: Clock;
	},
): Promise<CancelledAbsence> {
	const { organizationId, absenceId } = input;
	const transactionDb = context.dbService.db as AbsenceDatabase;
	const absence = (await transactionDb.query.absenceEntry.findFirst({
		where: and(eq(absenceEntry.id, absenceId), eq(absenceEntry.organizationId, organizationId)),
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

	const [ownedOrganization, canonicalRecord, workflowRow, requests, chains] = await Promise.all([
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
					(stage) => stage.organizationId !== organizationId || stage.chainInstanceId !== chain.id,
				),
		)
	) {
		fail();
	}
	if (absence.status !== "pending" && absence.status !== "approved") {
		fail("You do not have permission to cancel this absence");
	}
	const cancellable = absence as AbsenceForCancellation & { status: "pending" | "approved" };
	input.authorize(cancellable);

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
	const cancelledAt = (input.clock ?? systemClock).nowInstant();
	if (gate.shadowMirroring && (!absence.approvalWorkflowId || !workflowRow)) {
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
		const command = canonicalCommand(input.actor, {
			organizationId,
			workflowId: snapshot.id,
			version: snapshot.version,
		});
		const execution =
			await cancellation.runtime.transitionEngine.executeInTransactionWithDisposition(
				pinnedContext,
				{
					organizationId,
					workflowId: snapshot.id,
					expectedVersion: snapshot.version,
					idempotencyKey: command.idempotencyKey,
					principal: command.principal,
					command: { type: "cancel", reason: command.reason },
				},
			);
		return { absence, disposition: execution.disposition, deliveryIntent: false };
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
			query: <T>(_name: string, operation: () => Promise<T>) => Effect.promise(operation),
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
		const mirrorKey = input.actor.kind === "employee" ? "cancel" : "deactivation-cancel";
		const mirrored = await pinnedContext.compatibilityWriter.mirrorLegacyToCanonical({
			before,
			after,
			actor: mirrorActor(input.actor),
			idempotencyKey: `absence:${organizationId}:${absenceId}:${mirrorKey}:${workflowRow?.version ?? "initial"}`,
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
	cancellation.recordDeletedSickNotes(
		await deleteScopedAbsence(transactionDb, {
			absence,
			organizationId,
			expectedStatus: cancellable.status,
			expectedApprovalWorkflowId: absence.approvalWorkflowId,
			expectedCanonicalRecordId: absence.canonicalRecordId,
			actorUserId: actorUserIdOf(input.actor),
		}),
	);
	return { absence, disposition: "executed", deliveryIntent };
}
