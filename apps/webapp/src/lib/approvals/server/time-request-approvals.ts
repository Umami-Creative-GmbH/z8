import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import {
	timeEntry,
	timeRecord,
	timeRecordApprovalDecision,
	workPeriod,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { ConflictError, ValidationError } from "@/lib/effect/errors";
import type { ApprovalActionOptions } from "../domain/types";
import {
	classifyTimeRequest,
	classifyTimeRequestMetadata,
} from "../time-request-metadata";
import { processApprovalWithCurrentEmployee } from "./shared";
import {
	handleApprovedTimeCorrection,
	handleRejectedTimeCorrection,
} from "./time-correction-approvals";
import type {
	ApprovalAction,
	ApprovalDbService,
	CurrentApprover,
	PendingApprovalRequest,
} from "./types";

function finalizeOrdinaryTimeRequest(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
	action: ApprovalAction,
	reason?: string,
) {
	return dbService
		.query("finalizeOrdinaryTimeRequest", async () => {
			const period = await dbService.db.query.workPeriod.findFirst({
				where: and(
					eq(workPeriod.id, entityId),
					eq(workPeriod.organizationId, approval.organizationId),
					eq(workPeriod.approvalStatus, "pending"),
				),
				columns: { id: true, canonicalRecordId: true },
			});
			if (!period) {
				throw new ConflictError({
					message: "Work period approval is no longer pending",
					conflictType: "work_period_approval_status",
				});
			}

			const updatedPeriods = await dbService.db
				.update(workPeriod)
				.set({
					approvalStatus: action === "approve" ? "approved" : "rejected",
					pendingChanges: null,
					updatedAt: currentTimestamp(),
				})
				.where(
					and(
						eq(workPeriod.id, period.id),
						eq(workPeriod.organizationId, approval.organizationId),
						eq(workPeriod.approvalStatus, "pending"),
					),
				)
				.returning({ id: workPeriod.id });
			if (updatedPeriods.length !== 1) {
				throw new ConflictError({
					message: "Work period approval is no longer pending",
					conflictType: "work_period_approval_status",
				});
			}

			if (period.canonicalRecordId) {
				const updatedRecords = await dbService.db
					.update(timeRecord)
					.set({
						approvalState: action === "approve" ? "approved" : "rejected",
						updatedAt: currentTimestamp(),
						updatedBy: currentEmployee.userId,
					})
					.where(
						and(
							eq(timeRecord.id, period.canonicalRecordId),
							eq(timeRecord.organizationId, approval.organizationId),
							eq(timeRecord.recordKind, "work"),
							eq(timeRecord.approvalState, "pending"),
						),
					)
					.returning({ id: timeRecord.id });
				if (updatedRecords.length !== 1) {
					throw new ConflictError({
						message: "Canonical time record approval is no longer pending",
						conflictType: "time_record_approval_status",
					});
				}
				await dbService.db.insert(timeRecordApprovalDecision).values({
					organizationId: approval.organizationId,
					recordId: period.canonicalRecordId,
					actorEmployeeId: currentEmployee.id,
					action: action === "approve" ? "approved" : "rejected",
					reason: action === "reject" ? reason : null,
				});
			}
		})
		.pipe(Effect.asVoid);
}

function dispatchTimeRequestFinalizer(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
	action: ApprovalAction,
	reason?: string,
) {
	const classificationEffect =
		approval.metadata != null
			? Effect.succeed(classifyTimeRequestMetadata(approval.metadata))
			: dbService.query("classifyHistoricalTimeRequest", async () => {
					const period = await dbService.db.query.workPeriod.findFirst({
						where: and(
							eq(workPeriod.id, entityId),
							eq(workPeriod.organizationId, approval.organizationId),
						),
						columns: {
							clockInId: true,
							clockOutId: true,
							pendingChanges: true,
						},
					});
					if (!period) return { kind: "unclassified" } as const;
					const originalIds = [period.clockInId, period.clockOutId].filter(
						(id): id is string => Boolean(id),
					);
					const correctionEntries =
						originalIds.length > 0
							? await dbService.db.query.timeEntry.findMany({
									where: and(
										eq(timeEntry.organizationId, approval.organizationId),
										eq(timeEntry.type, "correction"),
										inArray(timeEntry.replacesEntryId, originalIds),
									),
									columns: {
										id: true,
										replacesEntryId: true,
										isSuperseded: true,
									},
								})
							: [];
					return classifyTimeRequest({
						metadata: null,
						reason: approval.reason,
						pendingChanges: period.pendingChanges,
						clockInId: period.clockInId,
						clockOutId: period.clockOutId,
						correctionEntries,
					});
				});

	return classificationEffect.pipe(
		Effect.flatMap((classification) => {
			if (classification.kind === "ordinary") {
				return finalizeOrdinaryTimeRequest(
					dbService,
					entityId,
					currentEmployee,
					approval,
					action,
					reason,
				);
			}
			if (
				classification.kind === "invalid" ||
				classification.kind === "unclassified"
			) {
				return Effect.fail(
					new ValidationError({
						message: "Time approval metadata is invalid or ambiguous",
						field: "metadata",
					}),
				);
			}
			return action === "approve"
				? handleApprovedTimeCorrection(
						dbService,
						entityId,
						currentEmployee,
						approval,
					)
				: handleRejectedTimeCorrection(
						dbService,
						entityId,
						currentEmployee,
						reason ?? "Rejected",
						approval,
					);
		}),
	);
}

export function processTimeRequestWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	entityId: string,
	action: ApprovalAction,
	reason?: string,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"time_entry",
		entityId,
		action,
		reason,
		(decisionDbService, workPeriodId, actor, approval) =>
			dispatchTimeRequestFinalizer(
				decisionDbService,
				workPeriodId,
				actor,
				approval,
				action,
				reason,
			),
		undefined,
		{ ...options, transactional: true },
	);
}
