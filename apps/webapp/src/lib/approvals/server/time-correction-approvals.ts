import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { approvalRequest, timeEntry, timeRecord, workPeriod } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	type AnyAppError,
	ConflictError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { createLogger } from "@/lib/logger";
import { onTimeCorrectionApproved, onTimeCorrectionRejected } from "@/lib/notifications/triggers";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import type { ApprovalActionOptions } from "../domain/types";
import {
	type ResolvePolicyAndCreateApprovalResult,
	resolvePolicyAndCreateApproval,
} from "../policies/chain-service";
import type {
	ApprovalPolicyEvaluationContext,
	ApprovalPolicyOvertimeRisk,
} from "../policies/types";
import { processApproval, processApprovalWithCurrentEmployee } from "./shared";
import type { ApprovalDbService, CurrentApprover, PendingApprovalRequest } from "./types";

const logger = createLogger("TimeCorrectionApprovals");

interface WorkPeriodRecord {
	id: string;
	employeeId: string;
	clockInId: string;
	clockOutId: string | null;
	organizationId: string;
	canonicalRecordId: string | null;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	deletedAt: Date | null;
	employee: {
		userId: string;
		organizationId: string;
		user: {
			name: string;
			email: string;
			image: string | null;
		};
	};
}

interface CorrectionEntry {
	id: string;
	timestamp: Date;
	replacesEntryId: string | null;
	isSuperseded: boolean;
}

type WorkBalanceDirtyMark = {
	employeeId: string;
	organizationId: string;
	dirtyFromDate?: string;
};

type TimeCorrectionApprovalResult = {
	period: WorkPeriodRecord;
	workBalanceDirtyMark?: WorkBalanceDirtyMark;
};

type TimeCorrectionAction = "edit" | "delete";

type TimeCorrectionApprovalMetadata = {
	timeCorrection?: {
		action?: TimeCorrectionAction;
		clockInCorrectionId?: string;
		clockOutCorrectionId?: string;
	};
};

function ensureWorkPeriod(
	period: WorkPeriodRecord | null,
): Effect.Effect<WorkPeriodRecord, NotFoundError> {
	return period
		? Effect.succeed(period)
		: Effect.fail(
				new NotFoundError({
					message: "Work period not found",
					entityType: "work_period",
				}),
			);
}

function isPendingApprovalUniqueConflict(error: DatabaseError) {
	const cause = error.cause as { code?: unknown; constraint?: unknown } | undefined;
	return (
		cause?.code === "23505" && cause.constraint === "approvalRequest_pending_entity_unique_idx"
	);
}

function pendingTimeCorrectionConflict(workPeriodId: string) {
	return new ConflictError({
		message: "A time correction approval is already pending for this work period",
		conflictType: "pending_time_correction_approval",
		details: { workPeriodId },
	});
}

function loadWorkPeriod(
	dbService: ApprovalDbService,
	entityId: string,
	organizationId: string,
): Effect.Effect<WorkPeriodRecord, AnyAppError, never> {
	return dbService
		.query("getWorkPeriod", async () => {
			return await dbService.db.query.workPeriod.findFirst({
				where: and(eq(workPeriod.id, entityId), eq(workPeriod.organizationId, organizationId)),
				with: {
					employee: {
						with: { user: true },
					},
				},
			});
		})
		.pipe(
			Effect.flatMap((period) => ensureWorkPeriod(period as unknown as WorkPeriodRecord | null)),
		);
}

function loadActiveCorrectionEntries(
	dbService: ApprovalDbService,
	period: WorkPeriodRecord,
	replacesEntryId: string,
) {
	return dbService
		.query("getCorrectionEntries", async () => {
			return await dbService.db
				.select()
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.type, "correction"),
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.organizationId, period.organizationId),
						eq(timeEntry.replacesEntryId, replacesEntryId),
						eq(timeEntry.isSuperseded, false),
					),
				);
		})
		.pipe(
			Effect.map((entries) =>
				(entries as CorrectionEntry[]).filter((entry) => !entry.isSuperseded),
			),
		);
}

function correctionEntryIdsFromApproval(approval: PendingApprovalRequest) {
	const metadata = approval.metadata as TimeCorrectionApprovalMetadata | null;
	return metadata?.timeCorrection;
}

function correctionActionFromApproval(approval: PendingApprovalRequest): TimeCorrectionAction {
	return correctionEntryIdsFromApproval(approval)?.action ?? "edit";
}

function loadApprovalLinkedCorrectionEntry(
	dbService: ApprovalDbService,
	period: WorkPeriodRecord,
	correctionId: string | undefined,
	replacesEntryId: string | null,
) {
	return dbService
		.query("getApprovalLinkedCorrectionEntry", async () => {
			if (!correctionId || !replacesEntryId) {
				return null;
			}

			return await dbService.db.query.timeEntry.findFirst({
				where: and(
					eq(timeEntry.id, correctionId),
					eq(timeEntry.type, "correction"),
					eq(timeEntry.employeeId, period.employeeId),
					eq(timeEntry.organizationId, period.organizationId),
					eq(timeEntry.replacesEntryId, replacesEntryId),
				),
			});
		})
		.pipe(Effect.map((entry) => entry as CorrectionEntry | null));
}

function resolveCorrectionEntryForApproval(
	dbService: ApprovalDbService,
	period: WorkPeriodRecord,
	correctionId: string | undefined,
	replacesEntryId: string | null,
	allowLegacyFallback: boolean,
) {
	if (correctionId) {
		return loadApprovalLinkedCorrectionEntry(dbService, period, correctionId, replacesEntryId);
	}

	if (!allowLegacyFallback || !replacesEntryId) {
		return Effect.succeed(null);
	}

	return loadActiveCorrectionEntries(dbService, period, replacesEntryId).pipe(
		Effect.flatMap((entries) => {
			if (entries.length === 1) {
				return Effect.succeed(entries[0]);
			}

			if (entries.length === 0) {
				return Effect.succeed(null);
			}

			return Effect.fail(
				new ConflictError({
					message: "Cannot resolve ambiguous legacy time correction approval",
					conflictType: "ambiguous_legacy_time_correction_approval",
					details: { workPeriodId: period.id, replacesEntryId },
				}),
			);
		}),
	);
}

function ensureOriginalEntryStillActive(
	dbService: ApprovalDbService,
	period: WorkPeriodRecord,
	originalEntryId: string | null,
	endpoint: "clock-in" | "clock-out",
) {
	return dbService
		.query("lockActiveCorrectionOriginal", async () => {
			if (!originalEntryId) {
				return null;
			}

			const [originalEntry] = await dbService.db
				.select({ id: timeEntry.id })
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.id, originalEntryId),
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.organizationId, period.organizationId),
						eq(timeEntry.isSuperseded, false),
					),
				)
				.for("update");
			return originalEntry ?? null;
		})
		.pipe(
			Effect.flatMap((originalEntry) =>
				originalEntry
					? Effect.void
					: Effect.fail(
							new ConflictError({
								message: `Original ${endpoint} entry is no longer active`,
								conflictType: "time_correction_original_superseded",
								details: { workPeriodId: period.id, originalEntryId },
							}),
						),
			),
		);
}

export function calculateCorrectedDurationMinutes(startTime: Date, endTime: Date) {
	const start = DateTime.fromJSDate(startTime, { zone: "utc" });
	const end = DateTime.fromJSDate(endTime, { zone: "utc" });
	return Math.floor(end.diff(start, "minutes").minutes);
}

export function buildTimeCorrectionApprovalPolicyContext(input: {
	organizationId: string;
	requesterEmployeeId: string;
	teamId: string | null;
	workPeriodId: string;
	overtimeRisk: ApprovalPolicyOvertimeRisk;
}): ApprovalPolicyEvaluationContext {
	return {
		organizationId: input.organizationId,
		approvalType: "time_entry",
		requesterEmployeeId: input.requesterEmployeeId,
		teamId: input.teamId,
		locationId: null,
		absenceCategoryId: null,
		travelExpenseAmount: null,
		overtimeRisk: input.overtimeRisk,
		employeeGroupIds: [],
		entityType: "time_entry",
		entityId: input.workPeriodId,
	};
}

export function createTimeCorrectionApprovalWorkflow(
	dbService: ApprovalDbService,
	input: {
		organizationId: string;
		requesterEmployeeId: string;
		teamId: string | null;
		workPeriodId: string;
		defaultApproverId: string;
		reason?: string;
		overtimeRisk: ApprovalPolicyOvertimeRisk;
		correctionAction?: TimeCorrectionAction;
		correctionEntryIds?: {
			clockInCorrectionId?: string;
			clockOutCorrectionId?: string;
		};
	},
): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> {
	const correctionAction = input.correctionAction ?? "edit";
	const correctionEntryIds = input.correctionEntryIds;
	if (
		correctionEntryIds &&
		Object.hasOwn(correctionEntryIds, "clockInCorrectionId") &&
		correctionEntryIds.clockInCorrectionId !== undefined &&
		(typeof correctionEntryIds.clockInCorrectionId !== "string" ||
			correctionEntryIds.clockInCorrectionId.trim().length === 0)
	) {
		return Effect.fail(
			new ValidationError({
				message: "Correction entry IDs must not be blank",
				field: "correctionEntryIds.clockInCorrectionId",
			}),
		);
	}
	if (
		correctionEntryIds &&
		Object.hasOwn(correctionEntryIds, "clockOutCorrectionId") &&
		correctionEntryIds.clockOutCorrectionId !== undefined &&
		(typeof correctionEntryIds.clockOutCorrectionId !== "string" ||
			correctionEntryIds.clockOutCorrectionId.trim().length === 0)
	) {
		return Effect.fail(
			new ValidationError({
				message: "Correction entry IDs must not be blank",
				field: "correctionEntryIds.clockOutCorrectionId",
			}),
		);
	}
	if (
		correctionEntryIds &&
		!correctionEntryIds.clockInCorrectionId &&
		!correctionEntryIds.clockOutCorrectionId
	) {
		return Effect.fail(
			new ValidationError({
				message: "Time correction approval must link at least one correction entry",
				field: "correctionEntryIds",
			}),
		);
	}
	if (
		correctionAction === "delete" &&
		(!correctionEntryIds?.clockInCorrectionId || !correctionEntryIds.clockOutCorrectionId)
	) {
		return Effect.fail(
			new ValidationError({
				message: "Deletion approval requires clock-in and clock-out correction entries",
				field: "correctionEntryIds",
			}),
		);
	}

	const metadata: Record<string, unknown> | undefined = input.correctionEntryIds
		? {
				timeCorrection: {
					action: correctionAction,
					...(input.correctionEntryIds.clockInCorrectionId
						? { clockInCorrectionId: input.correctionEntryIds.clockInCorrectionId }
						: {}),
					...(input.correctionEntryIds.clockOutCorrectionId
						? { clockOutCorrectionId: input.correctionEntryIds.clockOutCorrectionId }
						: {}),
				},
			}
		: undefined;

	return ensureNoPendingTimeCorrectionApproval(
		dbService,
		input.organizationId,
		input.workPeriodId,
	).pipe(
		Effect.flatMap(() =>
			resolvePolicyAndCreateApproval(dbService, {
				context: buildTimeCorrectionApprovalPolicyContext(input),
				defaultApproverId: input.defaultApproverId,
				reason: input.reason,
				metadata,
			}),
		),
		Effect.catchAll((error) => {
			if (error instanceof DatabaseError && isPendingApprovalUniqueConflict(error)) {
				return Effect.fail(pendingTimeCorrectionConflict(input.workPeriodId));
			}

			return Effect.fail(error);
		}),
	);
}

function ensureNoPendingTimeCorrectionApproval(
	dbService: ApprovalDbService,
	organizationId: string,
	workPeriodId: string,
) {
	return dbService
		.query("getPendingTimeCorrectionApproval", async () => {
			return await dbService.db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.organizationId, organizationId),
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, workPeriodId),
					eq(approvalRequest.status, "pending"),
				),
			});
		})
		.pipe(
			Effect.flatMap((pendingApproval) =>
				pendingApproval ? Effect.fail(pendingTimeCorrectionConflict(workPeriodId)) : Effect.void,
			),
		);
}

export async function syncCanonicalWorkCorrection(
	input: {
		organizationId: string;
		canonicalRecordId: string | null;
		startAt: Date;
		endAt: Date | null;
		durationMinutes: number | null;
		updatedBy: string;
	},
	client: ApprovalDbService["db"] = db,
): Promise<void> {
	if (!input.canonicalRecordId) {
		return;
	}

	await client
		.update(timeRecord)
		.set({
			startAt: input.startAt,
			endAt: input.endAt,
			durationMinutes: input.durationMinutes,
			updatedAt: currentTimestamp(),
			updatedBy: input.updatedBy,
		})
		.where(
			and(
				eq(timeRecord.id, input.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.recordKind, "work"),
			),
		);
}

export function approveTimeCorrectionWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	workPeriodId: string,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"time_entry",
		workPeriodId,
		"approve",
		undefined,
		handleApprovedTimeCorrection,
		undefined,
		{ ...options, transactional: true },
	).pipe(Effect.tap((result) => markWorkBalanceDirtyAfterCommit(result?.workBalanceDirtyMark)));
}

export function rejectTimeCorrectionWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	workPeriodId: string,
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
			handleRejectedTimeCorrection(decisionDbService, entityId, approver, reason, approval),
		undefined,
		{ ...options, transactional: true },
	);
}

function calculateCorrectedPeriod(
	period: WorkPeriodRecord,
	clockIn: CorrectionEntry | null,
	clockOut: CorrectionEntry | null,
) {
	const startTime = clockIn?.timestamp ?? period.startTime;
	const endTime = clockOut?.timestamp ?? period.endTime;

	return {
		clockInId: clockIn?.id ?? period.clockInId,
		clockOutId: clockOut?.id ?? period.clockOutId,
		startTime,
		endTime,
		durationMinutes: endTime ? calculateCorrectedDurationMinutes(startTime, endTime) : null,
	};
}

function calculateDeletedPeriod(clockIn: CorrectionEntry, clockOut: CorrectionEntry) {
	return {
		clockInId: clockIn.id,
		clockOutId: clockOut.id,
		startTime: clockIn.timestamp,
		endTime: clockOut.timestamp,
		durationMinutes: 0,
	};
}

function validateCorrectedPeriodRange(effectiveClockIn: Date, effectiveClockOut: Date | null) {
	const clockIn = DateTime.fromJSDate(effectiveClockIn, { zone: "utc" });
	const clockOut = effectiveClockOut
		? DateTime.fromJSDate(effectiveClockOut, { zone: "utc" })
		: null;
	if (clockOut && clockOut <= clockIn) {
		return Effect.fail(
			new ValidationError({
				message: "Clock out time must be after clock in time",
				field: "clockOut",
			}),
		);
	}

	return Effect.void;
}

function validateDeletedPeriodRange(clockIn: CorrectionEntry, clockOut: CorrectionEntry) {
	const clockInInstant = DateTime.fromJSDate(clockIn.timestamp, { zone: "utc" });
	const clockOutInstant = DateTime.fromJSDate(clockOut.timestamp, { zone: "utc" });
	if (clockInInstant.toMillis() !== clockOutInstant.toMillis()) {
		return Effect.fail(
			new ValidationError({
				message: "Deletion approval requires matching correction timestamps",
				field: "timeCorrection.clockOutCorrectionId",
			}),
		);
	}

	return Effect.void;
}

function ensureWorkPeriodNotDeleted(period: WorkPeriodRecord) {
	return period.deletedAt
		? Effect.fail(
				new ValidationError({
					message: "Cannot apply time correction to a deleted work period",
					field: "workPeriodId",
					value: period.id,
				}),
			)
		: Effect.void;
}

function applyTimeCorrection(
	dbService: ApprovalDbService,
	entityId: string,
	approval: PendingApprovalRequest,
	currentEmployee: CurrentApprover,
	correctionAction: TimeCorrectionAction,
	correctedPeriod: ReturnType<typeof calculateCorrectedPeriod>,
) {
	return dbService.query("applyTimeCorrection", async () => {
		const deletionFields =
			correctionAction === "delete"
				? {
						deletedAt: new Date(),
						deletedBy: currentEmployee.userId,
						deletionReason: approval.reason ?? null,
						deletionApprovalRequestId: approval.id,
					}
				: {};

		await dbService.db
			.update(workPeriod)
			.set({
				clockInId: correctedPeriod.clockInId,
				clockOutId: correctedPeriod.clockOutId,
				startTime: correctedPeriod.startTime,
				endTime: correctedPeriod.endTime,
				durationMinutes: correctedPeriod.durationMinutes,
				updatedAt: new Date(),
				...deletionFields,
			})
			.where(
				and(eq(workPeriod.id, entityId), eq(workPeriod.organizationId, approval.organizationId)),
			);
	});
}

function activateApprovedTimeCorrectionEntries(
	dbService: ApprovalDbService,
	period: WorkPeriodRecord,
	clockInCorrection: CorrectionEntry | null,
	clockOutCorrection: CorrectionEntry | null,
) {
	return dbService.query("activateApprovedTimeCorrectionEntries", async () => {
		const correctionEntryIds = [clockInCorrection?.id, clockOutCorrection?.id].filter(
			(id): id is string => Boolean(id),
		);

		await dbService.db
			.update(timeEntry)
			.set({ isSuperseded: false, supersededById: null })
			.where(
				and(
					eq(timeEntry.type, "correction"),
					eq(timeEntry.employeeId, period.employeeId),
					eq(timeEntry.organizationId, period.organizationId),
					inArray(timeEntry.id, correctionEntryIds),
				),
			);

		if (clockInCorrection) {
			await dbService.db
				.update(timeEntry)
				.set({ isSuperseded: true, supersededById: clockInCorrection.id })
				.where(
					and(
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.organizationId, period.organizationId),
						eq(timeEntry.id, period.clockInId),
					),
				);
		}

		if (period.clockOutId && clockOutCorrection) {
			await dbService.db
				.update(timeEntry)
				.set({ isSuperseded: true, supersededById: clockOutCorrection.id })
				.where(
					and(
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.organizationId, period.organizationId),
						eq(timeEntry.id, period.clockOutId),
					),
				);
		}
	});
}

function getDirtyFromDateForCorrection(period: WorkPeriodRecord, effectiveStartTime: Date) {
	const originalStart = DateTime.fromJSDate(period.startTime, { zone: "utc" });
	const correctedStart = DateTime.fromJSDate(effectiveStartTime, { zone: "utc" });
	const dirtyFromDateSource =
		originalStart.toMillis() <= correctedStart.toMillis() ? originalStart : correctedStart;
	return dirtyFromDateSource.toISODate() ?? undefined;
}

function markWorkBalanceDirtyAfterCommit(mark?: WorkBalanceDirtyMark) {
	return mark ? Effect.promise(() => markEmployeeWorkBalanceDirtyIfNeeded(mark)) : Effect.void;
}

async function markEmployeeWorkBalanceDirtyIfNeeded(mark?: WorkBalanceDirtyMark) {
	if (!mark) return;
	try {
		await markEmployeeWorkBalanceDirty(mark);
	} catch (error) {
		logger.error({ error, ...mark }, "Failed to mark work balance dirty");
	}
}

function notifyApprovedCorrection(
	period: WorkPeriodRecord,
	entityId: string,
	currentEmployee: CurrentApprover,
	originalTime: Date,
	correctedTime: Date,
) {
	void onTimeCorrectionApproved({
		workPeriodId: entityId,
		employeeUserId: period.employee.userId,
		employeeName: period.employee.user.name,
		organizationId: period.employee.organizationId,
		originalTime,
		correctedTime,
		approverName: currentEmployee.user.name,
	});
}

function notifyRejectedCorrection(
	period: WorkPeriodRecord,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
	originalTime: Date,
	correctedTime: Date,
) {
	void onTimeCorrectionRejected({
		workPeriodId: entityId,
		employeeUserId: period.employee.userId,
		employeeName: period.employee.user.name,
		organizationId: period.employee.organizationId,
		originalTime,
		correctedTime,
		approverName: currentEmployee.user.name,
		rejectionReason: reason,
	});
}

function rollbackRejectedTimeCorrection(
	dbService: ApprovalDbService,
	period: WorkPeriodRecord,
	correctionEntries: CorrectionEntry[],
	reactivateOriginals: boolean,
) {
	return dbService.query("rollbackRejectedTimeCorrection", async () => {
		const originalEntryIds = [period.clockInId, period.clockOutId].filter((id): id is string =>
			Boolean(id),
		);
		const correctionEntryIds = correctionEntries.map((entry) => entry.id);

		if (reactivateOriginals && originalEntryIds.length > 0) {
			await dbService.db
				.update(timeEntry)
				.set({ isSuperseded: false, supersededById: null })
				.where(
					and(
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.organizationId, period.organizationId),
						inArray(timeEntry.id, originalEntryIds),
					),
				);
		}

		if (correctionEntryIds.length > 0) {
			await dbService.db
				.update(timeEntry)
				.set({ isSuperseded: true, supersededById: null })
				.where(
					and(
						eq(timeEntry.type, "correction"),
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.organizationId, period.organizationId),
						inArray(timeEntry.id, correctionEntryIds),
					),
				);
		}
	});
}

function handleApprovedTimeCorrection(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
) {
	return Effect.gen(function* (_) {
		const period = yield* _(loadWorkPeriod(dbService, entityId, approval.organizationId));
		yield* _(ensureWorkPeriodNotDeleted(period));
		const correctionEntryIds = correctionEntryIdsFromApproval(approval);
		const correctionAction = correctionActionFromApproval(approval);
		const linkedClockInCorrection = yield* _(
			resolveCorrectionEntryForApproval(
				dbService,
				period,
				correctionEntryIds?.clockInCorrectionId,
				period.clockInId,
				!correctionEntryIds,
			),
		);
		const clockInCorrection = linkedClockInCorrection as CorrectionEntry | null;
		const linkedClockOutCorrection = yield* _(
			resolveCorrectionEntryForApproval(
				dbService,
				period,
				correctionEntryIds?.clockOutCorrectionId,
				period.clockOutId,
				!correctionEntryIds,
			),
		);
		const clockOutCorrection = linkedClockOutCorrection as CorrectionEntry | null;
		if (correctionEntryIds?.clockInCorrectionId && !clockInCorrection) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Declared clock-in correction could not be resolved",
						field: "timeCorrection.clockInCorrectionId",
					}),
				),
			);
		}
		if (correctionEntryIds?.clockOutCorrectionId && !clockOutCorrection) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Declared clock-out correction could not be resolved",
						field: "timeCorrection.clockOutCorrectionId",
					}),
				),
			);
		}
		if (correctionEntryIds?.clockInCorrectionId && clockInCorrection) {
			yield* _(ensureOriginalEntryStillActive(dbService, period, period.clockInId, "clock-in"));
		}
		if (correctionEntryIds?.clockOutCorrectionId && clockOutCorrection) {
			yield* _(ensureOriginalEntryStillActive(dbService, period, period.clockOutId, "clock-out"));
		}
		if (!clockInCorrection && !clockOutCorrection) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Time correction approval must link at least one correction entry",
						field: "timeCorrection",
					}),
				),
			);
		}
		if (correctionAction === "edit") {
			const effectiveStartTime = clockInCorrection?.timestamp ?? period.startTime;
			yield* _(
				validateCorrectedPeriodRange(
					effectiveStartTime,
					clockOutCorrection?.timestamp ?? period.endTime,
				),
			);
		}
		if (correctionAction === "delete" && (!clockInCorrection || !clockOutCorrection)) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Deletion approval requires clock-in and clock-out correction entries",
						field: "timeCorrection",
					}),
				),
			);
		}
		if (correctionAction === "delete" && clockInCorrection && clockOutCorrection) {
			yield* _(validateDeletedPeriodRange(clockInCorrection, clockOutCorrection));
		}
		const correctedPeriod =
			correctionAction === "delete" && clockInCorrection && clockOutCorrection
				? calculateDeletedPeriod(clockInCorrection, clockOutCorrection)
				: calculateCorrectedPeriod(period, clockInCorrection, clockOutCorrection);

		yield* _(
			activateApprovedTimeCorrectionEntries(
				dbService,
				period,
				clockInCorrection,
				clockOutCorrection,
			),
		);
		yield* _(
			applyTimeCorrection(
				dbService,
				entityId,
				approval,
				currentEmployee,
				correctionAction,
				correctedPeriod,
			),
		);
		const workBalanceDirtyMark = {
			employeeId: period.employeeId,
			organizationId: period.organizationId,
			dirtyFromDate: getDirtyFromDateForCorrection(period, correctedPeriod.startTime),
		};
		yield* _(
			dbService.query("syncCanonicalWorkCorrection", () =>
				syncCanonicalWorkCorrection(
					{
						organizationId: period.organizationId,
						canonicalRecordId: period.canonicalRecordId,
						startAt: correctedPeriod.startTime,
						endAt: correctedPeriod.endTime,
						durationMinutes: correctedPeriod.durationMinutes,
						updatedBy: currentEmployee.userId,
					},
					dbService.db,
				),
			),
		);
		const originalNotificationTime = clockInCorrection
			? period.startTime
			: (period.endTime ?? period.startTime);
		const correctedNotificationTime = clockInCorrection
			? correctedPeriod.startTime
			: (correctedPeriod.endTime ?? correctedPeriod.startTime);
		notifyApprovedCorrection(
			period,
			entityId,
			currentEmployee,
			originalNotificationTime,
			correctedNotificationTime,
		);

		return { period, workBalanceDirtyMark } satisfies TimeCorrectionApprovalResult;
	});
}

function handleRejectedTimeCorrection(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
	approval: PendingApprovalRequest,
) {
	return Effect.gen(function* (_) {
		const period = yield* _(loadWorkPeriod(dbService, entityId, approval.organizationId));
		const correctionEntryIds = correctionEntryIdsFromApproval(approval);
		const clockInCorrection = yield* _(
			resolveCorrectionEntryForApproval(
				dbService,
				period,
				correctionEntryIds?.clockInCorrectionId,
				period.clockInId,
				!correctionEntryIds,
			),
		);
		const clockOutCorrection = yield* _(
			resolveCorrectionEntryForApproval(
				dbService,
				period,
				correctionEntryIds?.clockOutCorrectionId,
				period.clockOutId,
				!correctionEntryIds,
			),
		);
		const correctionEntries = clockOutCorrection
			? [clockInCorrection, clockOutCorrection]
			: [clockInCorrection];

		yield* _(
			rollbackRejectedTimeCorrection(
				dbService,
				period,
				correctionEntries.filter((entry): entry is CorrectionEntry => Boolean(entry)),
				!correctionEntryIds,
			),
		);
		const originalNotificationTime = clockInCorrection
			? period.startTime
			: (period.endTime ?? period.startTime);
		const correctedNotificationTime =
			clockInCorrection?.timestamp ?? clockOutCorrection?.timestamp ?? originalNotificationTime;
		notifyRejectedCorrection(
			period,
			entityId,
			currentEmployee,
			reason,
			originalNotificationTime,
			correctedNotificationTime,
		);
		return { period } satisfies TimeCorrectionApprovalResult;
	});
}

export async function approveTimeCorrectionEffect(
	workPeriodId: string,
): Promise<ServerActionResult<void>> {
	const result = await processApproval(
		"time_entry",
		workPeriodId,
		"approve",
		undefined,
		handleApprovedTimeCorrection,
		undefined,
		{ transactional: true },
	);

	if (!result) return { success: true, data: undefined };
	if (result.success && result.data) {
		await markEmployeeWorkBalanceDirtyIfNeeded(result.data.workBalanceDirtyMark);
	}
	return result.success ? { success: true, data: undefined } : result;
}

export async function rejectTimeCorrectionEffect(
	workPeriodId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	const result = await processApproval(
		"time_entry",
		workPeriodId,
		"reject",
		reason,
		(dbService, entityId, currentEmployee, approval) =>
			handleRejectedTimeCorrection(dbService, entityId, currentEmployee, reason, approval),
		undefined,
		{ transactional: true },
	);

	if (!result) return { success: true, data: undefined };
	return result.success ? { success: true, data: undefined } : result;
}
