import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import {
	approvalRequest,
	employee,
	timeRecord,
	timeRecordApprovalDecision,
	workPeriod,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { ConflictError, NotFoundError } from "@/lib/effect/errors";
import {
	onClockOutApproved,
	onClockOutRejected,
	onManualEntryApproved,
	onManualEntryRejected,
} from "@/lib/notifications/triggers";
import type { ApprovalActionOptions } from "../domain/types";
import type { TimeApprovalKind } from "../time-request-kind";
import { processApprovalWithCurrentEmployee } from "./shared";
import type {
	ApprovalDbService,
	CurrentApprover,
	PendingApprovalRequest,
} from "./types";

export type OrdinaryTimeApprovalKind = Extract<
	TimeApprovalKind,
	"manual_time_submission" | "policy_clock_out"
>;

export interface WorkPeriodApprovalResult {
	kind: OrdinaryTimeApprovalKind;
	action: "approve" | "reject";
	reason: string | null;
	period: {
		id: string;
		organizationId: string;
		employeeId: string;
		canonicalRecordId: string;
		startTime: Date;
		endTime: Date;
	};
}

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
			persistWorkPeriodDecision(
				decisionDbService,
				entityId,
				approver,
				approval,
				kind,
				action,
				reason ?? null,
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

function persistWorkPeriodDecision(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
	kind: OrdinaryTimeApprovalKind,
	action: "approve" | "reject",
	reason: string | null,
) {
	return Effect.gen(function* (_) {
		const requestedBy = (approval as ApprovalWithRequester).requestedBy;
		const periods = yield* _(
			dbService.query("getOrdinaryApprovalWorkPeriod", async () => {
				return await dbService.db
					.select({
						id: workPeriod.id,
						organizationId: workPeriod.organizationId,
						employeeId: workPeriod.employeeId,
						canonicalRecordId: workPeriod.canonicalRecordId,
						startTime: workPeriod.startTime,
						endTime: workPeriod.endTime,
					})
					.from(workPeriod)
					.where(
						and(
							eq(workPeriod.id, entityId),
							eq(workPeriod.organizationId, approval.organizationId),
							eq(workPeriod.employeeId, requestedBy),
							isNull(workPeriod.deletedAt),
						),
					);
			}),
		);
		const period = periods[0];
		if (!period?.canonicalRecordId || !period.endTime) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Work period or canonical work record not found",
						entityType: "work_period",
						entityId,
					}),
				),
			);
		}
		const canonicalRecordId = period.canonicalRecordId;

		const approvalState = action === "approve" ? "approved" : "rejected";
		const updatedPeriods = yield* _(
			dbService.query("finalizeOrdinaryApprovalWorkPeriod", async () => {
				return await dbService.db
					.update(workPeriod)
					.set({
						approvalStatus: approvalState,
						pendingChanges: null,
						updatedAt: currentTimestamp(),
					})
					.where(
						and(
							eq(workPeriod.id, entityId),
							eq(workPeriod.organizationId, approval.organizationId),
							eq(workPeriod.employeeId, requestedBy),
							eq(workPeriod.approvalStatus, "pending"),
							isNull(workPeriod.deletedAt),
						),
					)
					.returning({ id: workPeriod.id });
			}),
		);
		if (updatedPeriods.length === 0) {
			return yield* _(
				Effect.fail(conflict("Work period is no longer pending approval")),
			);
		}

		const updatedRecords = yield* _(
			dbService.query("finalizeCanonicalWorkRecord", async () => {
				return await dbService.db
					.update(timeRecord)
					.set({
						approvalState,
						updatedAt: currentTimestamp(),
						updatedBy: currentEmployee.userId,
					})
					.where(
						and(
							eq(timeRecord.id, canonicalRecordId),
							eq(timeRecord.organizationId, approval.organizationId),
							eq(timeRecord.employeeId, requestedBy),
							eq(timeRecord.recordKind, "work"),
							eq(timeRecord.approvalState, "pending"),
						),
					)
					.returning({ id: timeRecord.id });
			}),
		);
		if (updatedRecords.length === 0) {
			return yield* _(
				Effect.fail(
					conflict("Canonical work record is no longer pending approval"),
				),
			);
		}

		yield* _(
			dbService.query("recordOrdinaryWorkApprovalDecision", async () => {
				await dbService.db.insert(timeRecordApprovalDecision).values({
					organizationId: approval.organizationId,
					recordId: canonicalRecordId,
					actorEmployeeId: currentEmployee.id,
					action: approvalState,
					...(reason ? { reason } : {}),
				});
			}),
		);

		return {
			kind,
			action,
			reason,
			period: { ...period, canonicalRecordId, endTime: period.endTime },
		} satisfies WorkPeriodApprovalResult;
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
			persistWorkPeriodDecision(
				decisionDbService,
				entityId,
				approver,
				approval,
				kind,
				"approve",
				null,
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
			persistWorkPeriodDecision(
				decisionDbService,
				entityId,
				approver,
				approval,
				kind,
				"reject",
				reason,
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
				Effect.fail(
					new NotFoundError({
						message: "Auto-completed work-period approval not found",
						entityType: "approval_request",
						entityId: input.approvalRequestId,
					}),
				),
			);
		}

		return yield* _(
			persistWorkPeriodDecision(
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
			),
		);
	});
}
