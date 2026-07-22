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
	type FinalizeOrdinaryWorkPeriodTerminalInput,
	type OrdinaryWorkPeriodApprovalKind,
	parseOrdinaryWorkPeriodWorkflowPayload,
	type WorkPeriodApprovalResult,
} from "../domain-adapters/work-period-contract";
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
				"ordinary",
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

function validateOrdinaryRequestMetadata(
	metadata: unknown,
	input: Pick<
		FinalizeOrdinaryWorkPeriodTerminalInput,
		"expectedApprovalWorkflowId" | "kind" | "organizationId"
	> & { requesterAutoCompleted: boolean },
): void {
	const root = exactOwnDataValues(
		metadata,
		input.expectedApprovalWorkflowId === null
			? input.requesterAutoCompleted
				? ["timeRequest", "autoApproval"]
				: ["timeRequest"]
			: input.requesterAutoCompleted
				? ["timeRequest", "workflow", "autoApproval"]
				: ["timeRequest", "workflow"],
	);
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
}

type OrdinaryFinalizationEvidenceExpectation =
	| "ordinary"
	| "requester_auto_completed";

async function finalizeOrdinaryWorkPeriodTerminal(
	input: FinalizeOrdinaryWorkPeriodTerminalInput,
	evidenceExpectation: OrdinaryFinalizationEvidenceExpectation,
): Promise<WorkPeriodApprovalResult> {
	const fail = ordinaryWorkPeriodFinalizationConflict;
	const db = input.dbService.db as ApprovalDbService["db"];
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
		(input.expectedApprovalWorkflowId === null &&
			!input.allowUnlinkedLegacySource)
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
				eq(approvalRequest.id, input.approvalRequestId),
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
		request.id !== input.approvalRequestId ||
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
		evidenceExpectation === "requester_auto_completed";
	if (requesterAutoCompleted !== persistedRequesterAutoCompleted) throw fail();
	try {
		validateOrdinaryRequestMetadata(request.metadata, {
			expectedApprovalWorkflowId: input.expectedApprovalWorkflowId,
			kind: input.kind,
			organizationId: input.organizationId,
			requesterAutoCompleted,
		});
	} catch {
		throw fail();
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
		return await finalizeOrdinaryWorkPeriodTerminal(input, "ordinary");
	} catch {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
}

async function finalizeOrdinaryWorkPeriodWithEvidenceExpectation(
	input: FinalizeOrdinaryWorkPeriodTerminalInput,
	evidenceExpectation: OrdinaryFinalizationEvidenceExpectation,
): Promise<WorkPeriodApprovalResult> {
	try {
		return await finalizeOrdinaryWorkPeriodTerminal(input, evidenceExpectation);
	} catch {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
}

function finalizeCurrentWorkPeriodDecision(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
	kind: OrdinaryTimeApprovalKind,
	action: "approve" | "reject",
	reason: string | null,
	evidenceExpectation: OrdinaryFinalizationEvidenceExpectation,
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
					finalizeOrdinaryWorkPeriodWithEvidenceExpectation(
						{
							dbService,
							organizationId: approval.organizationId,
							workPeriodId: entityId,
							approvalRequestId: approval.id,
							expectedApprovalWorkflowId: source.approvalWorkflowId,
							requesterEmployeeId: requestedBy,
							actorEmployeeId: currentEmployee.id,
							actorUserId: currentEmployee.userId,
							kind,
							transition:
								action === "approve"
									? { kind: "approve", reason }
									: { kind: "reject", reason: reason ?? "" },
							finalizedAt: systemClock.nowInstant(),
							allowUnlinkedLegacySource: source.approvalWorkflowId === null,
						},
						evidenceExpectation,
					),
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
				"ordinary",
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
				"ordinary",
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
