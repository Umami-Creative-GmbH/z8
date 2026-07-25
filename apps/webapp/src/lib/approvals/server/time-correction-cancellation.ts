import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	employee,
	workPeriod,
} from "@/db/schema";
import { instantFromDB, instantToDB } from "@/lib/datetime/drizzle-adapter";
import {
	compareInstants,
	isInstant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ConflictError } from "@/lib/effect/errors";
import { createLegacyApprovalWriteCoordinator } from "../domain-adapters/legacy-write-coordinator";
import { buildRequesterCancellationMarker } from "../domain-adapters/time-correction-cancellation-marker";
import { normalizeTimeCorrectionWorkflowPayload } from "../domain-adapters/time-correction-contract";
import { captureTimeCorrectionLegacyApprovalState } from "../domain-adapters/time-correction-legacy-state";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import { cancelLegacyTimeCorrectionApprovalRows } from "../workflow/compatibility-writer";
import type {
	ApprovalWriteGate,
	VerifiedLegacyApprovalState,
} from "../workflow/ports";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import {
	type CancelledTimeCorrectionSourceEvidence,
	deleteCancelledTimeCorrectionsInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
	lockTimeCorrectionSubmissionSourceInTransaction,
} from "./time-correction-approvals";
import { finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction } from "./work-period-approvals";

export interface CancelPendingTimeCorrectionInput {
	organizationId: string;
	requesterEmployeeId: string;
	requesterUserId: string;
	workPeriodId: string;
}

export async function cancelPendingTimeCorrection(
	input: CancelPendingTimeCorrectionInput,
): Promise<{ replayed: boolean }> {
	const runtime = createProductionApprovalWorkflowRuntime({
		db,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async () => {
					throw new Error("Absence finalization is outside this boundary");
				},
				deleteCancelledAbsence: async () => {
					throw new Error("Absence cancellation is outside this boundary");
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
		canManageApproval: async () => false,
		clock: systemClock,
	});

	try {
		return await runtime.repository.withTransaction(async (context) => {
			const database = context.dbService.db as typeof db;
			const requesters = await database.query.employee.findMany({
				where: and(
					eq(employee.id, input.requesterEmployeeId),
					eq(employee.organizationId, input.organizationId),
					eq(employee.userId, input.requesterUserId),
					eq(employee.isActive, true),
				),
				limit: 2,
			});
			const memberships = await database.query.member.findMany({
				where: and(
					eq(member.organizationId, input.organizationId),
					eq(member.userId, input.requesterUserId),
					eq(member.status, "approved"),
				),
				limit: 2,
			});
			const periods = await database.query.workPeriod.findMany({
				where: and(
					eq(workPeriod.id, input.workPeriodId),
					eq(workPeriod.organizationId, input.organizationId),
					eq(workPeriod.employeeId, input.requesterEmployeeId),
				),
				limit: 2,
			});
			const requester = requesters[0];
			const membership = memberships[0];
			const period = periods[0];
			if (
				requesters.length !== 1 ||
				memberships.length !== 1 ||
				periods.length !== 1 ||
				!requester ||
				!membership ||
				!period ||
				requester.id !== input.requesterEmployeeId ||
				requester.organizationId !== input.organizationId ||
				requester.userId !== input.requesterUserId ||
				requester.isActive !== true ||
				membership.organizationId !== input.organizationId ||
				membership.userId !== input.requesterUserId ||
				membership.status !== "approved" ||
				period.id !== input.workPeriodId ||
				period.organizationId !== input.organizationId ||
				period.employeeId !== input.requesterEmployeeId
			) {
				throw new Error("Time correction cancellation is unavailable");
			}

			let lockedPeriod: Awaited<
				ReturnType<typeof lockTimeCorrectionSubmissionSourceInTransaction>
			>;
			try {
				lockedPeriod = await lockTimeCorrectionSubmissionSourceInTransaction({
					dbService: context.dbService as never,
					organizationId: input.organizationId,
					requesterEmployeeId: input.requesterEmployeeId,
					requesterUserId: input.requesterUserId,
					workPeriodId: input.workPeriodId,
					expectedApprovalWorkflowId: period.approvalWorkflowId,
				});
			} catch {
				throw new Error("Time correction cancellation is unavailable");
			}
			const gate = await context.writeGate.acquire({
				organizationId: input.organizationId,
				workflowType: "time_correction",
			});
			const fixedGate = fixedCancellationGate(input.organizationId, gate);
			const transactionContext: ApprovalWorkflowTransactionContext = {
				...context,
				writeGate: fixedGate,
				compatibilityWriter:
					context.compatibilityWriter.withWriteGate(fixedGate),
			};
			if (
				gate.mode === "legacy" ||
				gate.mode === "shadow" ||
				gate.mode === "ready"
			) {
				const observedWorkflow =
					gate.mode === "legacy"
						? null
						: await loadCancellationWorkflow(
								context,
								input,
								lockedPeriod.approvalWorkflowId,
								true,
							);
				const capturedAt = systemClock.nowInstant();
				const cancelledAt = instantToDB(capturedAt);
				if (!cancelledAt) {
					throw new Error("Time correction cancellation is unavailable");
				}
				const cancelledReplay = await resolveCancelledLegacyReplay({
					context,
					input,
					observedWorkflow,
				});
				if (cancelledReplay) {
					const replayState = await captureTimeCorrectionLegacyApprovalState({
						dbService: context.dbService as never,
						organizationId: input.organizationId,
						workPeriodId: input.workPeriodId,
						capturedAt,
						expectedCorrection: cancelledReplay.correction,
						expectedLegacyCycle: cancelledReplay.chainInstanceId
							? { chainInstanceId: cancelledReplay.chainInstanceId }
							: { approvalRequestId: cancelledReplay.approvalRequestId },
						allowCancelledReplayWithoutCorrectionRows: true,
					});
					if (
						isExactLegacyCancellationReplay(replayState, input, {
							chainInstanceId: cancelledReplay.chainInstanceId,
							approvalRequestId: cancelledReplay.approvalRequestId,
							approvalWorkflowId: observedWorkflow?.id ?? null,
						})
					) {
						return { replayed: true };
					}
					throw new Error("Time correction cancellation is unavailable");
				}
				if (observedWorkflow?.status === "cancelled") {
					throw new Error("Time correction cancellation is unavailable");
				}
				const before = await captureTimeCorrectionLegacyApprovalState({
					dbService: context.dbService as never,
					organizationId: input.organizationId,
					workPeriodId: input.workPeriodId,
					capturedAt,
				});
				if (
					before.sourceSnapshot.approvalWorkflowId !==
					(observedWorkflow?.id ?? null)
				) {
					throw new Error("Time correction cancellation is unavailable");
				}
				const legacy = exactPendingLegacyEvidence(before, input);
				const expectedSource = cancellationSourceFromCapture({
					state: before,
					input,
					expectedApprovalWorkflowId: observedWorkflow?.id ?? null,
					correction: legacy.correction,
				});
				let captureCount = 0;
				const coordinator = createLegacyApprovalWriteCoordinator({
					writeGate: fixedGate,
					compatibilityWriter: transactionContext.compatibilityWriter,
				});
				await coordinator.execute({
					organizationId: input.organizationId,
					workflowType: "time_correction",
					sourceIdentity: {
						organizationId: input.organizationId,
						workflowType: "time_correction",
						sourceType: "time_entry",
						sourceId: input.workPeriodId,
					},
					actor: {
						kind: "employee",
						employeeId: input.requesterEmployeeId,
						userId: input.requesterUserId,
					},
					idempotencyKey: cancellationKey(input, observedWorkflow?.id),
					expectedVersion: observedWorkflow?.version ?? null,
					captureState: async () => {
						captureCount += 1;
						if (captureCount === 1) return before;
						return await captureTimeCorrectionLegacyApprovalState({
							dbService: context.dbService as never,
							organizationId: input.organizationId,
							workPeriodId: input.workPeriodId,
							capturedAt,
							expectedCorrection: legacy.correction,
							expectedLegacyCycle: legacy.cycle,
							...(before.chain === null
								? {
										priorVerifiedDirectRequest: {
											approvalRequest: before.approvalRequest,
											chain: before.chain,
											chainRows: before.chainRows,
										},
									}
								: {}),
						});
					},
					mutate: async () => {
						await cancelLegacyTimeCorrectionApprovalRows({
							dbService: context.dbService as never,
							organizationId: input.organizationId,
							workPeriodId: input.workPeriodId,
							requesterEmployeeId: input.requesterEmployeeId,
							state: before,
							cancelledAt,
							retainDirectCancellation: true,
							directCancellationMetadata: durableRequesterCancellationMetadata(
								before.approvalRequest?.metadata,
								input,
								cancelledAt,
								before.chain?.id ?? null,
							),
						});
					},
					afterMirror: async () => {
						await deleteCancelledTimeCorrectionsInTransaction({
							dbService: context.dbService as never,
							organizationId: input.organizationId,
							workPeriodId: input.workPeriodId,
							expectedSource,
							correction: legacy.correction,
						});
					},
				});
				if (gate.mode === "legacy") {
					await deleteCancelledTimeCorrectionsInTransaction({
						dbService: context.dbService as never,
						organizationId: input.organizationId,
						workPeriodId: input.workPeriodId,
						expectedSource,
						correction: legacy.correction,
					});
				}
				return { replayed: false };
			}

			const workflow = await loadCancellationWorkflow(
				context,
				input,
				lockedPeriod.approvalWorkflowId,
				true,
			);
			const execution =
				await runtime.transitionEngine.executeInTransactionWithDisposition(
					transactionContext,
					{
						organizationId: input.organizationId,
						workflowId: workflow.id,
						expectedVersion: workflow.version,
						idempotencyKey: cancellationKey(input, workflow.id),
						principal: { kind: "employee", userId: input.requesterUserId },
						command: { type: "cancel", reason: "requester_cancelled" },
					},
				);
			return { replayed: execution.disposition === "replayed" };
		});
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "Time correction cancellation is unavailable"
		) {
			throw new ConflictError({
				message: error.message,
				conflictType: "time_correction_cancellation_conflict",
				details: { workPeriodId: input.workPeriodId },
			});
		}
		throw error;
	}
}

async function resolveCancelledLegacyReplay(input: {
	context: ApprovalWorkflowTransactionContext;
	input: CancelPendingTimeCorrectionInput;
	observedWorkflow: Awaited<ReturnType<typeof loadCancellationWorkflow>> | null;
}): Promise<{
	chainInstanceId: string | null;
	approvalRequestId: string;
	correction: ReturnType<
		typeof normalizeTimeCorrectionWorkflowPayload
	>["timeCorrection"];
} | null> {
	if (input.observedWorkflow?.status === "pending") return null;
	const database = input.context.dbService.db as typeof db;
	const chains = await database.query.approvalChainInstance.findMany({
		where: and(
			eq(approvalChainInstance.organizationId, input.input.organizationId),
			eq(approvalChainInstance.entityType, "time_entry"),
			eq(approvalChainInstance.entityId, input.input.workPeriodId),
			eq(
				approvalChainInstance.requesterEmployeeId,
				input.input.requesterEmployeeId,
			),
		),
		orderBy: [
			desc(approvalChainInstance.createdAt),
			desc(approvalChainInstance.id),
		],
		limit: 2,
	});
	const chain = chains[0];
	if (!chain) {
		const requests = await database.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, input.input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, input.input.workPeriodId),
				eq(approvalRequest.requestedBy, input.input.requesterEmployeeId),
			),
			orderBy: [desc(approvalRequest.createdAt), desc(approvalRequest.id)],
			limit: 2,
		});
		const request = requests[0];
		if (!request) return null;
		if (
			(requests[1] &&
				compareCancellationDatabaseTimestamps(
					requests[1].createdAt,
					request.createdAt,
				) === 0) ||
			request.organizationId !== input.input.organizationId ||
			request.entityType !== "time_entry" ||
			request.entityId !== input.input.workPeriodId ||
			request.requestedBy !== input.input.requesterEmployeeId
		) {
			throw new Error("Time correction cancellation is unavailable");
		}
		const correction = exactDirectRequesterCancellation(request, input.input);
		if (
			!correction &&
			requests
				.slice(1)
				.some(
					(candidate) =>
						exactDirectRequesterCancellation(candidate, input.input) !== null,
				)
		) {
			throw new Error("Time correction cancellation is unavailable");
		}
		return correction
			? { chainInstanceId: null, approvalRequestId: request.id, correction }
			: null;
	}
	if (
		(chains[1] &&
			compareCancellationDatabaseTimestamps(
				chains[1].createdAt,
				chain.createdAt,
			) === 0) ||
		chain.organizationId !== input.input.organizationId ||
		chain.entityType !== "time_entry" ||
		chain.entityId !== input.input.workPeriodId ||
		chain.requesterEmployeeId !== input.input.requesterEmployeeId
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	if (chain.status === "pending") {
		if (chains.slice(1).some((candidate) => candidate.status === "cancelled")) {
			throw new Error("Time correction cancellation is unavailable");
		}
		return null;
	}
	if (chain.status !== "cancelled") {
		throw new Error("Time correction cancellation is unavailable");
	}
	const stages = await database.query.approvalChainStageInstance.findMany({
		where: and(
			eq(approvalChainStageInstance.organizationId, input.input.organizationId),
			eq(approvalChainStageInstance.chainInstanceId, chain.id),
		),
		orderBy: [
			approvalChainStageInstance.stepOrder,
			approvalChainStageInstance.id,
		],
	});
	if (
		stages.length === 0 ||
		stages.some(
			(stage) =>
				stage.organizationId !== input.input.organizationId ||
				stage.chainInstanceId !== chain.id ||
				stage.status === "pending",
		) ||
		!stages.some(
			(stage) =>
				stage.status === "cancelled" && stage.approvalRequestId === null,
		)
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	const chainRequestIds = new Set(
		stages.flatMap((stage) =>
			stage.approvalRequestId ? [stage.approvalRequestId] : [],
		),
	);
	const requests = await database.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.organizationId, input.input.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
			eq(approvalRequest.entityId, input.input.workPeriodId),
			eq(approvalRequest.requestedBy, input.input.requesterEmployeeId),
		),
		orderBy: [desc(approvalRequest.createdAt), desc(approvalRequest.id)],
		limit: 2,
	});
	const cancelledTombstones = requests.flatMap((request) => {
		const correction = exactRequesterCancellation(
			request,
			input.input,
			chain.id,
		);
		return correction ? [{ request, correction }] : [];
	});
	if (cancelledTombstones.length > 1) {
		throw new Error("Time correction cancellation is unavailable");
	}
	const cancelledTombstone = cancelledTombstones[0] ?? null;
	const newerForeignRequest = requests.find(
		(request) =>
			request.id !== cancelledTombstone?.request.id &&
			!chainRequestIds.has(request.id) &&
			compareCancellationDatabaseTimestamps(
				request.createdAt,
				chain.createdAt,
			) >= 0,
	);
	if (newerForeignRequest) {
		throw new Error("Time correction cancellation is unavailable");
	}
	let correction:
		| ReturnType<
				typeof normalizeTimeCorrectionWorkflowPayload
		  >["timeCorrection"]
		| undefined;
	try {
		if (input.observedWorkflow) {
			correction = normalizeTimeCorrectionWorkflowPayload({
				timeCorrection: input.observedWorkflow.contextSnapshot.timeCorrection,
			}).timeCorrection;
		} else if (cancelledTombstone) {
			correction = cancelledTombstone.correction;
		} else {
			const chainRequests = requests.filter((request) =>
				chainRequestIds.has(request.id),
			);
			const corrections = chainRequests.map(
				(request) =>
					normalizeTimeCorrectionWorkflowPayload({
						timeCorrection: cancellationRecord(request.metadata).timeCorrection,
					}).timeCorrection,
			);
			correction = corrections[0];
			if (
				!correction ||
				corrections.some(
					(candidate) =>
						JSON.stringify(candidate) !== JSON.stringify(correction),
				)
			) {
				throw new Error("ambiguous correction evidence");
			}
		}
	} catch {
		throw new Error("Time correction cancellation is unavailable");
	}
	return {
		chainInstanceId: chain.id,
		approvalRequestId: cancelledTombstone?.request.id ?? chain.id,
		correction,
	};
}

function compareCancellationDatabaseTimestamps(
	left: Date,
	right: Date,
): number {
	const leftInstant = instantFromDB(left);
	const rightInstant = instantFromDB(right);
	if (!leftInstant || !rightInstant) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return compareInstants(leftInstant, rightInstant);
}

function exactDirectRequesterCancellation(
	request: {
		status: string;
		rejectionReason?: string | null;
		approvedAt?: unknown;
		metadata: unknown;
	},
	input: CancelPendingTimeCorrectionInput,
):
	| ReturnType<typeof normalizeTimeCorrectionWorkflowPayload>["timeCorrection"]
	| null {
	return exactRequesterCancellation(request, input, null);
}

function exactRequesterCancellation(
	request: {
		status: string;
		rejectionReason?: string | null;
		approvedAt?: unknown;
		metadata: unknown;
	},
	input: CancelPendingTimeCorrectionInput,
	expectedChainInstanceId: string | null,
):
	| ReturnType<typeof normalizeTimeCorrectionWorkflowPayload>["timeCorrection"]
	| null {
	if (
		request.status !== "rejected" ||
		request.rejectionReason !== null ||
		request.approvedAt === null ||
		request.approvedAt === undefined
	) {
		return null;
	}
	try {
		const metadata = cancellationRecord(request.metadata);
		const cancellation = cancellationRecord(metadata.cancellation);
		if (
			Reflect.ownKeys(cancellation).length !== 7 ||
			cancellation.kind !== "requester" ||
			cancellation.organizationId !== input.organizationId ||
			cancellation.requesterEmployeeId !== input.requesterEmployeeId ||
			cancellation.requesterUserId !== input.requesterUserId ||
			cancellation.workPeriodId !== input.workPeriodId ||
			cancellation.chainInstanceId !== expectedChainInstanceId
		) {
			return null;
		}
		const approvedAt =
			request.approvedAt instanceof Date
				? instantFromDB(request.approvedAt)
				: isInstant(request.approvedAt)
					? request.approvedAt
					: null;
		if (
			!approvedAt ||
			compareInstants(
				cancellationInstant(cancellation.cancelledAt),
				approvedAt,
			) !== 0
		) {
			return null;
		}
		if (!requesterCancellationSubmission(metadata)) return null;
		return normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: metadata.timeCorrection,
		}).timeCorrection;
	} catch {
		return null;
	}
}

function isExactLegacyCancellationReplay(
	state: VerifiedLegacyApprovalState,
	input: CancelPendingTimeCorrectionInput,
	expected: {
		chainInstanceId: string | null;
		approvalRequestId: string;
		approvalWorkflowId: string | null;
	},
): boolean {
	const chain = state.chain;
	if (expected.chainInstanceId === null) {
		const request = state.approvalRequest;
		return (
			state.organizationId === input.organizationId &&
			state.source.organizationId === input.organizationId &&
			state.source.workflowType === "time_correction" &&
			state.source.sourceType === "time_entry" &&
			state.source.sourceId === input.workPeriodId &&
			state.sourceSnapshot.organizationId === input.organizationId &&
			state.sourceSnapshot.employeeId === input.requesterEmployeeId &&
			state.sourceSnapshot.approvalWorkflowId === expected.approvalWorkflowId &&
			chain === null &&
			state.chainRows.length === 0 &&
			request?.id === expected.approvalRequestId &&
			exactDirectRequesterCancellation(request, input) !== null
		);
	}
	if (
		state.organizationId !== input.organizationId ||
		state.source.organizationId !== input.organizationId ||
		state.source.workflowType !== "time_correction" ||
		state.source.sourceType !== "time_entry" ||
		state.source.sourceId !== input.workPeriodId ||
		state.approvalRequest !== null ||
		state.sourceSnapshot.organizationId !== input.organizationId ||
		state.sourceSnapshot.employeeId !== input.requesterEmployeeId ||
		state.sourceSnapshot.status !== "cancelled" ||
		state.sourceSnapshot.approvalWorkflowId !== expected.approvalWorkflowId ||
		!chain ||
		chain.id !== expected.chainInstanceId ||
		chain.organizationId !== input.organizationId ||
		chain.entityType !== "time_entry" ||
		chain.entityId !== input.workPeriodId ||
		chain.requesterEmployeeId !== input.requesterEmployeeId ||
		chain.status !== "cancelled" ||
		state.chainRows.length === 0 ||
		state.chainRows.some(
			(stage) =>
				stage.organizationId !== input.organizationId ||
				stage.chainInstanceId !== chain.id ||
				stage.status === "pending",
		) ||
		!state.chainRows.some(
			(stage) =>
				stage.status === "cancelled" && stage.approvalRequestId === null,
		)
	) {
		return false;
	}
	try {
		normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: state.sourceSnapshot.timeCorrection,
		});
		return true;
	} catch {
		return false;
	}
}

function cancellationRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return value as Record<string, unknown>;
}

function cancellationString(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return value;
}

function cancellationNullableString(value: unknown): string | null {
	return value === null ? null : cancellationString(value);
}

function cancellationInteger(value: unknown): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return value;
}

function cancellationNullableInteger(value: unknown): number | null {
	return value === null ? null : cancellationInteger(value);
}

function cancellationBoolean(value: unknown): boolean {
	if (typeof value !== "boolean") {
		throw new Error("Time correction cancellation is unavailable");
	}
	return value;
}

function cancellationInstant(value: unknown) {
	try {
		return parseInstant(cancellationString(value));
	} catch {
		throw new Error("Time correction cancellation is unavailable");
	}
}

function cancellationNullableInstant(value: unknown) {
	return value === null ? null : cancellationInstant(value);
}

function cancellationEntryFromCapture(
	value: unknown,
	logicalRole: "clock_in" | "clock_out",
): CancelledTimeCorrectionSourceEvidence["currentEndpoints"]["clockIn"] {
	const entry = cancellationRecord(value);
	const type = cancellationString(entry.type);
	if (
		(type !== "clock_in" && type !== "clock_out" && type !== "correction") ||
		entry.isDeleted !== false
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return {
		id: cancellationString(entry.id),
		organizationId: cancellationString(entry.organizationId),
		employeeId: cancellationString(entry.employeeId),
		logicalRole,
		type,
		replacesEntryId: cancellationNullableString(entry.replacesEntryId),
		timestamp: cancellationInstant(entry.timestamp),
		utcOffsetMinutes: cancellationInteger(entry.utcOffsetMinutes),
		timezone: cancellationString(entry.timezone),
		timezoneSource: cancellationString(entry.timezoneSource),
		isSuperseded: cancellationBoolean(entry.isSuperseded),
		supersededById: cancellationNullableString(entry.supersededById),
	};
}

function cancellationSourceFromCapture(input: {
	state: VerifiedLegacyApprovalState;
	input: CancelPendingTimeCorrectionInput;
	expectedApprovalWorkflowId: string | null;
	correction: ReturnType<typeof exactPendingLegacyEvidence>["correction"];
}): CancelledTimeCorrectionSourceEvidence {
	const snapshot = input.state.sourceSnapshot;
	const period = cancellationRecord(snapshot.workPeriod);
	const canonical = cancellationRecord(snapshot.canonicalRecord);
	const currentEndpoints = cancellationRecord(snapshot.currentEndpoints);
	if (
		cancellationString(snapshot.id) !== input.input.workPeriodId ||
		cancellationString(snapshot.organizationId) !==
			input.input.organizationId ||
		cancellationString(snapshot.employeeId) !==
			input.input.requesterEmployeeId ||
		snapshot.status !== "pending" ||
		cancellationString(snapshot.canonicalRecordId) !==
			cancellationString(period.canonicalRecordId) ||
		cancellationNullableString(snapshot.approvalWorkflowId) !==
			input.expectedApprovalWorkflowId ||
		cancellationNullableString(period.approvalWorkflowId) !==
			input.expectedApprovalWorkflowId ||
		period.pendingChanges !== null ||
		period.deletedAt !== null ||
		period.approvalStatus !== "approved" ||
		canonical.approvalState !== "approved"
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	const clockIn = cancellationEntryFromCapture(
		currentEndpoints.clockIn,
		"clock_in",
	);
	const clockOut =
		currentEndpoints.clockOut === null
			? null
			: cancellationEntryFromCapture(currentEndpoints.clockOut, "clock_out");
	const pendingCorrections: CancelledTimeCorrectionSourceEvidence["pendingCorrections"] =
		{
			clockIn: null,
			clockOut: null,
		};
	const correctionEndpoints = Array.isArray(snapshot.correctionEndpoints)
		? snapshot.correctionEndpoints
		: [];
	for (const value of correctionEndpoints) {
		const endpoint = cancellationRecord(value);
		const endpointType = cancellationString(endpoint.endpointType);
		if (endpointType !== "clock_in" && endpointType !== "clock_out") {
			throw new Error("Time correction cancellation is unavailable");
		}
		const correctionEntry = cancellationEntryFromCapture(
			endpoint.correction,
			endpointType,
		);
		if (
			correctionEntry.id !== cancellationString(endpoint.correctionEntryId) ||
			correctionEntry.replacesEntryId !==
				cancellationString(endpoint.originalEntryId) ||
			pendingCorrections[
				endpointType === "clock_in" ? "clockIn" : "clockOut"
			] !== null
		) {
			throw new Error("Time correction cancellation is unavailable");
		}
		pendingCorrections[endpointType === "clock_in" ? "clockIn" : "clockOut"] =
			correctionEntry;
	}
	if (
		(input.correction.clockInCorrectionId ?? null) !==
			(pendingCorrections.clockIn?.id ?? null) ||
		(input.correction.clockOutCorrectionId ?? null) !==
			(pendingCorrections.clockOut?.id ?? null)
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	const clockOutId = cancellationNullableString(period.clockOutId);
	if ((clockOutId === null) !== (clockOut === null)) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return {
		employeeId: cancellationString(period.employeeId),
		approvalWorkflowId: input.expectedApprovalWorkflowId,
		canonicalRecordId: cancellationString(period.canonicalRecordId),
		clockInId: cancellationString(period.clockInId),
		clockOutId,
		startTime: cancellationInstant(period.startTime),
		endTime: cancellationNullableInstant(period.endTime),
		durationMinutes: cancellationNullableInteger(period.durationMinutes),
		isActive: cancellationBoolean(period.isActive),
		approvalStatus: "approved",
		pendingChanges: null,
		canonicalRecord: {
			id: cancellationString(canonical.id),
			employeeId: cancellationString(canonical.employeeId),
			recordKind:
				canonical.recordKind === "work"
					? "work"
					: (() => {
							throw new Error("Time correction cancellation is unavailable");
						})(),
			startAt: cancellationInstant(canonical.startAt),
			endAt: cancellationNullableInstant(canonical.endAt),
			durationMinutes: cancellationNullableInteger(canonical.durationMinutes),
			approvalState: "approved",
		},
		currentEndpoints: { clockIn, clockOut },
		pendingCorrections,
	};
}

function cancellationKey(
	input: CancelPendingTimeCorrectionInput,
	workflowId: string | undefined,
): string {
	return `time-correction:${input.organizationId}:${workflowId ?? input.workPeriodId}:${input.requesterEmployeeId}:cancel`;
}

async function loadCancellationWorkflow(
	context: ApprovalWorkflowTransactionContext,
	input: CancelPendingTimeCorrectionInput,
	workflowId: string | null,
	allowReplay = false,
) {
	if (!workflowId)
		throw new Error("Time correction cancellation is unavailable");
	const workflow = await context.repository.loadSnapshot({
		organizationId: input.organizationId,
		workflowId,
	});
	if (
		workflow.organizationId !== input.organizationId ||
		workflow.id !== workflowId ||
		workflow.workflowType !== "time_correction" ||
		workflow.sourceType !== "time_entry" ||
		workflow.sourceId !== input.workPeriodId ||
		workflow.requesterEmployeeId !== input.requesterEmployeeId ||
		(workflow.status !== "pending" &&
			!(allowReplay && workflow.status === "cancelled"))
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return workflow;
}

function exactPendingLegacyEvidence(
	state: VerifiedLegacyApprovalState,
	input: CancelPendingTimeCorrectionInput,
) {
	const request = state.approvalRequest;
	const source = state.sourceSnapshot;
	if (
		state.organizationId !== input.organizationId ||
		state.source.organizationId !== input.organizationId ||
		state.source.workflowType !== "time_correction" ||
		state.source.sourceType !== "time_entry" ||
		state.source.sourceId !== input.workPeriodId ||
		!request ||
		request.organizationId !== input.organizationId ||
		request.entityType !== "time_entry" ||
		request.entityId !== input.workPeriodId ||
		request.requestedBy !== input.requesterEmployeeId ||
		request.status !== "pending" ||
		source.employeeId !== input.requesterEmployeeId ||
		source.status !== "pending"
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	if (
		(state.chain === null && state.chainRows.length !== 0) ||
		(state.chain !== null &&
			(state.chain.organizationId !== input.organizationId ||
				state.chain.entityType !== "time_entry" ||
				state.chain.entityId !== input.workPeriodId ||
				state.chain.requesterEmployeeId !== input.requesterEmployeeId ||
				state.chain.status !== "pending" ||
				state.chainRows.some(
					(stage) =>
						stage.organizationId !== input.organizationId ||
						stage.chainInstanceId !== state.chain?.id,
				)))
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	const correction = normalizeTimeCorrectionWorkflowPayload({
		timeCorrection: source.timeCorrection,
	}).timeCorrection;
	const correctionIds = [
		correction.clockInCorrectionId,
		correction.clockOutCorrectionId,
	].filter((id): id is string => Boolean(id));
	if (
		correctionIds.length === 0 ||
		new Set(correctionIds).size !== correctionIds.length
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	if (!Array.isArray(source.correctionEndpoints)) {
		throw new Error("Time correction cancellation is unavailable");
	}
	const correctionRows = source.correctionEndpoints.map((value) => {
		const endpoint = cancellationRecord(value);
		return {
			id: cancellationString(endpoint.correctionEntryId),
			replacesEntryId: cancellationString(endpoint.originalEntryId),
		};
	});
	if (
		correctionRows.length !== correctionIds.length ||
		correctionRows.some((row) => !correctionIds.includes(row.id))
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return {
		correction,
		correctionIds,
		cycle: {
			approvalRequestId: request.id,
			...(state.chain ? { chainInstanceId: state.chain.id } : {}),
		},
	};
}

function durableRequesterCancellationMetadata(
	value: unknown,
	input: CancelPendingTimeCorrectionInput,
	cancelledAt: Date,
	chainInstanceId: string | null,
): Record<string, unknown> {
	const metadata = cancellationRecord(value);
	const correction = normalizeTimeCorrectionWorkflowPayload({
		timeCorrection: metadata.timeCorrection,
	}).timeCorrection;
	const submission = requesterCancellationSubmission(metadata);
	if (!submission) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return {
		timeCorrection: correction,
		submission,
		cancellation: buildRequesterCancellationMarker({
			organizationId: input.organizationId,
			requesterEmployeeId: input.requesterEmployeeId,
			requesterUserId: input.requesterUserId,
			workPeriodId: input.workPeriodId,
			chainInstanceId,
			cancelledAt: cancelledAt.toISOString(),
		}),
	};
}

function requesterCancellationSubmission(
	metadata: Record<string, unknown>,
): Record<string, string> | null {
	const descriptor = Object.getOwnPropertyDescriptor(metadata, "submission");
	if (!descriptor) return null;
	if (!descriptor.enumerable || !("value" in descriptor)) {
		throw new Error("Time correction cancellation is unavailable");
	}
	const submission = descriptor.value;
	if (
		typeof submission !== "object" ||
		submission === null ||
		Array.isArray(submission) ||
		(Object.getPrototypeOf(submission) !== Object.prototype &&
			Object.getPrototypeOf(submission) !== null)
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	const record = submission as Record<string, unknown>;
	const hasSubmissionId = Object.hasOwn(record, "submissionId");
	const keys = Reflect.ownKeys(record);
	const allowed = ["key", "submissionId", "resultKind", "originalStatus"];
	if (
		keys.length !== (hasSubmissionId ? 4 : 3) ||
		keys.some((key) => typeof key !== "string" || !allowed.includes(key))
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	for (const key of keys) {
		const child = Object.getOwnPropertyDescriptor(record, key);
		if (!child?.enumerable || !("value" in child)) {
			throw new Error("Time correction cancellation is unavailable");
		}
	}
	const key = record.key;
	const submissionId = record.submissionId;
	const resultKind = record.resultKind;
	const originalStatus = record.originalStatus;
	if (
		typeof key !== "string" ||
		key.length === 0 ||
		(hasSubmissionId &&
			(typeof submissionId !== "string" ||
				!CANCELLATION_UUID.test(submissionId))) ||
		(resultKind !== "default_created" &&
			resultKind !== "chain_created" &&
			resultKind !== "auto_completed") ||
		(originalStatus !== "pending" && originalStatus !== "approved") ||
		(resultKind === "auto_completed") !== (originalStatus === "approved")
	) {
		throw new Error("Time correction cancellation is unavailable");
	}
	return {
		key,
		...(typeof submissionId === "string" ? { submissionId } : {}),
		resultKind,
		originalStatus,
	};
}

const CANCELLATION_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fixedCancellationGate(
	organizationId: string,
	gate: Awaited<ReturnType<ApprovalWriteGate["acquire"]>>,
): ApprovalWriteGate {
	return {
		acquire: async (scope) => {
			if (
				scope.organizationId !== organizationId ||
				scope.workflowType !== "time_correction"
			) {
				throw new Error("Time correction cancellation is unavailable");
			}
			return gate;
		},
	};
}
