import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import {
	approvalRequest,
	employee,
	timeRecord,
	timeRecordApprovalDecision,
	workPeriod,
} from "@/db/schema";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { ConflictError } from "@/lib/effect/errors";
import {
	onClockOutApproved,
	onClockOutRejected,
	onManualEntryApproved,
	onManualEntryRejected,
} from "@/lib/notifications/triggers";
import type { ApprovalActionOptions } from "../domain/types";
import {
	type FinalizeOrdinaryWorkPeriodTerminalAdapterInput,
	type FinalizeOrdinaryWorkPeriodTerminalInput,
	type OrdinaryWorkPeriodApprovalKind,
	type OrdinaryWorkPeriodFinalizerDatabase,
	type OrdinaryWorkPeriodFinalizerDbService,
	type OrdinaryWorkPeriodTerminalEvidence,
	parseOrdinaryWorkPeriodWorkflowPayload,
	type WorkPeriodApprovalResult,
} from "../domain-adapters/work-period-contract";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import { processApprovalWithCurrentEmployee } from "./shared";
import type {
	ApprovalDbService,
	CurrentApprover,
	PendingApprovalRequest,
} from "./types";

export type OrdinaryTimeApprovalKind = OrdinaryWorkPeriodApprovalKind;
export type {
	FinalizeOrdinaryWorkPeriodTerminalInput,
	WorkPeriodApprovalResult,
} from "../domain-adapters/work-period-contract";

export function decideWorkPeriodWithCurrentApproverInTransaction(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	workPeriodId: string,
	kind: OrdinaryTimeApprovalKind,
	action: "approve" | "reject",
	reason: string | undefined,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"time_entry",
		workPeriodId,
		action,
		reason,
		(decisionDbService, entityId, approver, approval) =>
			finalizeCurrentWorkPeriodDecision(
				decisionDbService,
				entityId,
				approver,
				approval,
				kind,
				action,
				reason ?? null,
				"manager",
			),
		undefined,
		{ ...options, transactional: true },
		undefined,
		"existing",
	);
}

type ApprovalWithRequester = PendingApprovalRequest & { requestedBy: string };

function conflict(message: string) {
	return new ConflictError({ message, conflictType: "approval_status" });
}

function ordinaryWorkPeriodFinalizationConflict(): Error {
	return new Error("Ordinary work-period finalization conflict");
}

function sameDate(left: Date, right: Date): boolean {
	return left.getTime() === right.getTime();
}

function exactOwnDataValues(
	value: unknown,
	expectedKeys: readonly string[],
): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const result: Record<string, unknown> = {};
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
		result[key] = descriptor.value;
	}
	return result;
}

function exactOwnDataValue(value: unknown, key: string): unknown {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !("value" in descriptor)) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	return descriptor.value;
}

function validateTerminalEvidence(
	input: FinalizeOrdinaryWorkPeriodTerminalInput,
): OrdinaryWorkPeriodTerminalEvidence {
	const evidenceValue = exactOwnDataValue(input, "evidence");
	const mode = exactOwnDataValue(evidenceValue, "mode");
	if (mode === "canonical") {
		const evidence = exactOwnDataValues(evidenceValue, [
			"mode",
			"workflowId",
			"payload",
		]);
		if (
			typeof evidence.workflowId !== "string" ||
			evidence.workflowId !== input.expectedApprovalWorkflowId
		) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
		const payload = parseOrdinaryWorkPeriodWorkflowPayload(
			evidence.payload,
			input.kind,
		);
		return { mode, workflowId: evidence.workflowId, payload };
	}
	if (mode === "legacy") {
		const evidence = exactOwnDataValues(evidenceValue, [
			"mode",
			"approvalRequestId",
			"requestMode",
			"expectedStatus",
		]);
		if (
			typeof evidence.approvalRequestId !== "string" ||
			(evidence.requestMode !== "manager" &&
				evidence.requestMode !== "requester_auto_completed") ||
			(evidence.expectedStatus !== "approved" &&
				evidence.expectedStatus !== "rejected") ||
			(evidence.requestMode === "requester_auto_completed" &&
				evidence.expectedStatus !== "approved")
		) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
		return {
			mode,
			approvalRequestId: evidence.approvalRequestId,
			requestMode: evidence.requestMode,
			expectedStatus: evidence.expectedStatus,
		};
	}
	throw ordinaryWorkPeriodFinalizationConflict();
}

function validateOrdinaryRequestMetadata(
	metadata: unknown,
	input: Pick<
		FinalizeOrdinaryWorkPeriodTerminalInput,
		"expectedApprovalWorkflowId" | "kind" | "organizationId" | "workPeriodId"
	> & { requesterAutoCompleted: boolean },
): void {
	const markerDescriptor =
		typeof metadata === "object" &&
		metadata !== null &&
		!Array.isArray(metadata)
			? Object.getOwnPropertyDescriptor(metadata, "ordinarySubmission")
			: undefined;
	if (
		markerDescriptor &&
		(!markerDescriptor.enumerable || !("value" in markerDescriptor))
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const hasMarker = markerDescriptor !== undefined;
	const expectedKeys = [
		"timeRequest",
		...(input.expectedApprovalWorkflowId !== null ? ["workflow"] : []),
		...(hasMarker ? ["ordinarySubmission"] : []),
		...(input.requesterAutoCompleted ? ["autoApproval"] : []),
	];
	const root = exactOwnDataValues(metadata, expectedKeys);
	parseOrdinaryWorkPeriodWorkflowPayload(
		{ timeRequest: root.timeRequest },
		input.kind,
	);
	if (input.expectedApprovalWorkflowId !== null) {
		const workflow = exactOwnDataValues(root.workflow, [
			"id",
			"organizationId",
		]);
		if (
			workflow.id !== input.expectedApprovalWorkflowId ||
			workflow.organizationId !== input.organizationId
		) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
	}
	if (input.requesterAutoCompleted) {
		const autoApproval = exactOwnDataValues(root.autoApproval, ["reason"]);
		if (autoApproval.reason !== "requester_is_approver") {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
	}
	if (hasMarker) {
		const marker = exactOwnDataValues(root.ordinarySubmission, ["key"]);
		const expectedKey = deriveApprovalWorkflowId({
			organizationId: input.organizationId,
			workflowType: input.kind,
			sourceType: "time_entry",
			sourceId: input.workPeriodId,
			allocationKey: "ordinary-submission",
		});
		if (marker.key !== expectedKey) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
	}
}

async function finalizeOrdinaryWorkPeriodTerminal(
	input: FinalizeOrdinaryWorkPeriodTerminalInput,
): Promise<WorkPeriodApprovalResult> {
	const fail = ordinaryWorkPeriodFinalizationConflict;
	const evidence = validateTerminalEvidence(input);
	const db = input.dbService.db;
	const periods = await db
		.select({
			id: workPeriod.id,
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
			canonicalRecordId: workPeriod.canonicalRecordId,
			approvalWorkflowId: workPeriod.approvalWorkflowId,
			approvalStatus: workPeriod.approvalStatus,
			pendingChanges: workPeriod.pendingChanges,
			isActive: workPeriod.isActive,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			deletedAt: workPeriod.deletedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.requesterEmployeeId),
			),
		)
		.for("update");
	if (periods.length !== 1) throw fail();
	const period = periods[0];
	if (
		!period ||
		period.id !== input.workPeriodId ||
		period.organizationId !== input.organizationId ||
		period.employeeId !== input.requesterEmployeeId ||
		period.approvalStatus !== "pending" ||
		period.isActive !== false ||
		period.deletedAt !== null ||
		!period.clockInId ||
		!period.clockOutId ||
		!period.canonicalRecordId ||
		!period.endTime ||
		period.durationMinutes === null ||
		period.approvalWorkflowId !== input.expectedApprovalWorkflowId ||
		(evidence.mode === "canonical" &&
			period.approvalWorkflowId !== evidence.workflowId)
	) {
		throw fail();
	}

	const records = await db
		.select({
			id: timeRecord.id,
			organizationId: timeRecord.organizationId,
			employeeId: timeRecord.employeeId,
			recordKind: timeRecord.recordKind,
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
			durationMinutes: timeRecord.durationMinutes,
			approvalState: timeRecord.approvalState,
		})
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, period.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.employeeId, input.requesterEmployeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.for("update");
	if (records.length !== 1) throw fail();
	const record = records[0];
	if (
		!record ||
		record.id !== period.canonicalRecordId ||
		record.organizationId !== input.organizationId ||
		record.employeeId !== period.employeeId ||
		record.recordKind !== "work" ||
		record.approvalState !== "pending" ||
		!record.endAt ||
		record.durationMinutes === null ||
		!sameDate(record.startAt, period.startTime) ||
		!sameDate(record.endAt, period.endTime) ||
		record.durationMinutes !== period.durationMinutes
	) {
		throw fail();
	}

	const actor = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, input.actorEmployeeId),
			eq(employee.organizationId, input.organizationId),
			eq(employee.userId, input.actorUserId),
		),
		columns: { id: true, userId: true },
	});
	if (
		!actor ||
		actor.id !== input.actorEmployeeId ||
		actor.userId !== input.actorUserId
	) {
		throw fail();
	}

	const terminalStatus =
		input.transition.kind === "approve" ? "approved" : "rejected";
	if (evidence.mode === "legacy") {
		if (evidence.expectedStatus !== terminalStatus) throw fail();
		const requests = await db
			.select({
				id: approvalRequest.id,
				organizationId: approvalRequest.organizationId,
				entityType: approvalRequest.entityType,
				entityId: approvalRequest.entityId,
				requestedBy: approvalRequest.requestedBy,
				approverId: approvalRequest.approverId,
				status: approvalRequest.status,
				approvedAt: approvalRequest.approvedAt,
				canonicalRecordId: approvalRequest.canonicalRecordId,
				rejectionReason: approvalRequest.rejectionReason,
				metadata: approvalRequest.metadata,
			})
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.id, evidence.approvalRequestId),
					eq(approvalRequest.organizationId, input.organizationId),
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, input.workPeriodId),
					eq(approvalRequest.requestedBy, input.requesterEmployeeId),
					eq(approvalRequest.status, terminalStatus),
				),
			)
			.limit(2);
		if (requests.length !== 1) throw fail();
		const request = requests[0];
		if (
			!request ||
			request.id !== evidence.approvalRequestId ||
			request.organizationId !== input.organizationId ||
			request.entityType !== "time_entry" ||
			request.entityId !== input.workPeriodId ||
			request.requestedBy !== input.requesterEmployeeId ||
			request.status !== terminalStatus ||
			(request.canonicalRecordId !== null &&
				request.canonicalRecordId !== period.canonicalRecordId) ||
			(input.transition.kind === "reject" &&
				request.rejectionReason !== input.transition.reason)
		) {
			throw fail();
		}
		const persistedRequesterAutoCompleted =
			request.status === "approved" &&
			request.requestedBy === input.requesterEmployeeId &&
			request.approverId === input.requesterEmployeeId &&
			request.approvedAt instanceof Date &&
			!Number.isNaN(request.approvedAt.getTime());
		const requesterAutoCompleted =
			evidence.requestMode === "requester_auto_completed";
		if (requesterAutoCompleted !== persistedRequesterAutoCompleted)
			throw fail();
		try {
			validateOrdinaryRequestMetadata(request.metadata, {
				expectedApprovalWorkflowId: input.expectedApprovalWorkflowId,
				kind: input.kind,
				organizationId: input.organizationId,
				workPeriodId: input.workPeriodId,
				requesterAutoCompleted,
			});
		} catch {
			throw fail();
		}
	}

	const finalizedAt = dateFromInstant(input.finalizedAt);
	const updatedPeriods = await db
		.update(workPeriod)
		.set({
			approvalStatus: terminalStatus,
			pendingChanges: null,
			updatedAt: finalizedAt,
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, period.organizationId),
				eq(workPeriod.employeeId, period.employeeId),
				eq(workPeriod.clockInId, period.clockInId),
				eq(workPeriod.clockOutId, period.clockOutId),
				eq(workPeriod.canonicalRecordId, period.canonicalRecordId),
				input.expectedApprovalWorkflowId === null
					? isNull(workPeriod.approvalWorkflowId)
					: eq(workPeriod.approvalWorkflowId, input.expectedApprovalWorkflowId),
				eq(workPeriod.startTime, period.startTime),
				eq(workPeriod.endTime, period.endTime),
				eq(workPeriod.durationMinutes, period.durationMinutes),
				eq(workPeriod.approvalStatus, "pending"),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning({ id: workPeriod.id });
	if (updatedPeriods.length !== 1 || updatedPeriods[0]?.id !== period.id) {
		throw fail();
	}

	const updatedRecords = await db
		.update(timeRecord)
		.set({
			approvalState: terminalStatus,
			updatedAt: finalizedAt,
			updatedBy: input.actorUserId,
		})
		.where(
			and(
				eq(timeRecord.id, record.id),
				eq(timeRecord.organizationId, record.organizationId),
				eq(timeRecord.employeeId, record.employeeId),
				eq(timeRecord.recordKind, "work"),
				eq(timeRecord.startAt, record.startAt),
				eq(timeRecord.endAt, record.endAt),
				eq(timeRecord.durationMinutes, record.durationMinutes),
				eq(timeRecord.approvalState, "pending"),
			),
		)
		.returning({ id: timeRecord.id });
	if (updatedRecords.length !== 1 || updatedRecords[0]?.id !== record.id) {
		throw fail();
	}

	const decisions = await db
		.insert(timeRecordApprovalDecision)
		.values({
			organizationId: input.organizationId,
			recordId: record.id,
			actorEmployeeId: input.actorEmployeeId,
			action: terminalStatus,
			reason: input.transition.reason,
			createdAt: finalizedAt,
		})
		.returning({ id: timeRecordApprovalDecision.id });
	if (decisions.length !== 1) throw fail();

	return {
		kind: input.kind,
		action: input.transition.kind,
		reason: input.transition.reason,
		period: {
			id: period.id,
			organizationId: period.organizationId,
			employeeId: period.employeeId,
			canonicalRecordId: period.canonicalRecordId,
			startTime: new Date(period.startTime.getTime()),
			endTime: new Date(period.endTime.getTime()),
		},
	};
}

export async function finalizeOrdinaryWorkPeriodTerminalInTransaction(
	input: FinalizeOrdinaryWorkPeriodTerminalInput,
): Promise<WorkPeriodApprovalResult> {
	try {
		return await finalizeOrdinaryWorkPeriodTerminal(input);
	} catch {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
}

function isOrdinaryWorkPeriodFinalizerDatabase(
	value: unknown,
): value is OrdinaryWorkPeriodFinalizerDatabase {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	const query = candidate.query;
	if (typeof query !== "object" || query === null) return false;
	const employeeQuery = (query as Record<string, unknown>).employee;
	return (
		typeof candidate.select === "function" &&
		typeof candidate.update === "function" &&
		typeof candidate.insert === "function" &&
		typeof employeeQuery === "object" &&
		employeeQuery !== null &&
		typeof (employeeQuery as Record<string, unknown>).findFirst === "function"
	);
}

export function requireOrdinaryWorkPeriodFinalizerDbService(
	dbService: FinalizeOrdinaryWorkPeriodTerminalAdapterInput["dbService"],
): OrdinaryWorkPeriodFinalizerDbService {
	if (!isOrdinaryWorkPeriodFinalizerDatabase(dbService.db)) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	return { db: dbService.db };
}

export async function finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction(
	input: FinalizeOrdinaryWorkPeriodTerminalAdapterInput,
): Promise<WorkPeriodApprovalResult> {
	return finalizeOrdinaryWorkPeriodTerminalInTransaction({
		...input,
		dbService: requireOrdinaryWorkPeriodFinalizerDbService(input.dbService),
	});
}

function finalizeCurrentWorkPeriodDecision(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
	kind: OrdinaryTimeApprovalKind,
	action: "approve" | "reject",
	reason: string | null,
	requestMode: "manager" | "requester_auto_completed",
) {
	return Effect.gen(function* (_) {
		const requestedBy = (approval as ApprovalWithRequester).requestedBy;
		const source = yield* _(
			dbService.query("getOrdinaryApprovalWorkflowLink", async () => {
				return await dbService.db.query.workPeriod.findFirst({
					where: and(
						eq(workPeriod.id, entityId),
						eq(workPeriod.organizationId, approval.organizationId),
						eq(workPeriod.employeeId, requestedBy),
					),
					columns: { approvalWorkflowId: true },
				});
			}),
		);
		if (!source) {
			return yield* _(
				Effect.fail(conflict("Ordinary work-period finalization conflict")),
			);
		}

		return yield* _(
			Effect.tryPromise({
				try: () =>
					finalizeOrdinaryWorkPeriodTerminalInTransaction({
						dbService,
						organizationId: approval.organizationId,
						workPeriodId: entityId,
						expectedApprovalWorkflowId: source.approvalWorkflowId,
						requesterEmployeeId: requestedBy,
						actorEmployeeId: currentEmployee.id,
						actorUserId: currentEmployee.userId,
						kind,
						evidence: {
							mode: "legacy",
							approvalRequestId: approval.id,
							requestMode,
							expectedStatus: action === "approve" ? "approved" : "rejected",
						},
						transition:
							action === "approve"
								? { kind: "approve", reason }
								: { kind: "reject", reason: reason ?? "" },
						finalizedAt: systemClock.nowInstant(),
					}),
				catch: () => conflict("Ordinary work-period finalization conflict"),
			}),
		);
	});
}

export function notifyWorkPeriodApprovalAfterCommit(
	result: WorkPeriodApprovalResult,
	currentEmployee: CurrentApprover,
	dbService: ApprovalDbService,
) {
	return Effect.promise(async () => {
		const requester = await dbService.db.query.employee.findFirst({
			where: and(
				eq(employee.id, result.period.employeeId),
				eq(employee.organizationId, result.period.organizationId),
			),
			columns: { userId: true },
		});
		if (!requester) return;
		const params = {
			workPeriodId: result.period.id,
			employeeUserId: requester.userId,
			organizationId: result.period.organizationId,
			approverName: currentEmployee.user.name,
			startTime: result.period.startTime,
			endTime: result.period.endTime,
			...(result.reason ? { rejectionReason: result.reason } : {}),
		};

		if (result.kind === "manual_time_submission") {
			await (result.action === "approve"
				? onManualEntryApproved(params)
				: onManualEntryRejected(params));
			return;
		}

		await (result.action === "approve"
			? onClockOutApproved(params)
			: onClockOutRejected(params));
	});
}

export function approveWorkPeriodWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	workPeriodId: string,
	kind: OrdinaryTimeApprovalKind,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"time_entry",
		workPeriodId,
		"approve",
		undefined,
		(decisionDbService, entityId, approver, approval) =>
			finalizeCurrentWorkPeriodDecision(
				decisionDbService,
				entityId,
				approver,
				approval,
				kind,
				"approve",
				null,
				"manager",
			),
		undefined,
		{ ...options, transactional: true },
	).pipe(
		Effect.flatMap((result) =>
			result
				? notifyWorkPeriodApprovalAfterCommit(
						result,
						currentEmployee,
						dbService,
					).pipe(Effect.as(result))
				: Effect.void,
		),
	);
}

export function rejectWorkPeriodWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	workPeriodId: string,
	kind: OrdinaryTimeApprovalKind,
	reason: string,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"time_entry",
		workPeriodId,
		"reject",
		reason,
		(decisionDbService, entityId, approver, approval) =>
			finalizeCurrentWorkPeriodDecision(
				decisionDbService,
				entityId,
				approver,
				approval,
				kind,
				"reject",
				reason,
				"manager",
			),
		undefined,
		{ ...options, transactional: true },
	).pipe(
		Effect.flatMap((result) =>
			result
				? notifyWorkPeriodApprovalAfterCommit(
						result,
						currentEmployee,
						dbService,
					).pipe(Effect.as(result))
				: Effect.void,
		),
	);
}

export function finalizeAutoCompletedWorkPeriodApprovalEffect(
	dbService: ApprovalDbService,
	input: {
		approvalRequestId: string;
		organizationId: string;
		requesterEmployeeId: string;
		requesterUserId: string;
		requesterName: string;
		kind: OrdinaryTimeApprovalKind;
	},
) {
	return Effect.gen(function* (_) {
		const approvals = yield* _(
			dbService.query("getAutoCompletedWorkPeriodApproval", async () => {
				return await dbService.db
					.select()
					.from(approvalRequest)
					.where(
						and(
							eq(approvalRequest.id, input.approvalRequestId),
							eq(approvalRequest.organizationId, input.organizationId),
							eq(approvalRequest.entityType, "time_entry"),
							eq(approvalRequest.requestedBy, input.requesterEmployeeId),
							eq(approvalRequest.status, "approved"),
						),
					);
			}),
		);
		const approval = approvals[0];
		if (!approval) {
			return yield* _(
				Effect.fail(conflict("Ordinary work-period finalization conflict")),
			);
		}

		return yield* _(
			finalizeCurrentWorkPeriodDecision(
				dbService,
				approval.entityId,
				{
					id: input.requesterEmployeeId,
					userId: input.requesterUserId,
					organizationId: input.organizationId,
					user: {
						id: input.requesterUserId,
						name: input.requesterName,
						email: "",
						image: null,
					},
				},
				approval as PendingApprovalRequest,
				input.kind,
				"approve",
				"requester_is_approver",
				"requester_auto_completed",
			),
		);
	});
}
