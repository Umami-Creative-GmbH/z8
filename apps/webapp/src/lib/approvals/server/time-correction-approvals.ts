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

type TimeCorrectionApprovalMetadata = {
	timeCorrection?: {
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
		cause?.code === "23505" &&
		cause.constraint === "approvalRequest_pending_entity_unique_idx"
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
): Effect.Effect<WorkPeriodRecord, AnyAppError, never> {
	return dbService
		.query("getWorkPeriod", async () => {
			return await dbService.db.query.workPeriod.findFirst({
				where: eq(workPeriod.id, entityId),
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
		.pipe(Effect.map((entries) => (entries as CorrectionEntry[]).filter((entry) => !entry.isSuperseded)));
}

function correctionEntryIdsFromApproval(approval: PendingApprovalRequest) {
	const metadata = approval.metadata as TimeCorrectionApprovalMetadata | null;
	return metadata?.timeCorrection;
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

function ensureClockInCorrection(
	clockInCorrection: CorrectionEntry | undefined,
): Effect.Effect<CorrectionEntry, NotFoundError> {
	return clockInCorrection
		? Effect.succeed(clockInCorrection)
		: Effect.fail(
				new NotFoundError({
					message: "Clock in correction not found",
					entityType: "time_entry",
				}),
			);
}

export function calculateCorrectedDurationMinutes(startTime: Date, endTime: Date) {
	return Math.floor((endTime.getTime() - startTime.getTime()) / 60000);
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
		correctionEntryIds?: {
			clockInCorrectionId: string;
			clockOutCorrectionId?: string;
		};
	},
): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> {
	const metadata: Record<string, unknown> | undefined = input.correctionEntryIds
		? {
				timeCorrection: {
					clockInCorrectionId: input.correctionEntryIds.clockInCorrectionId,
					clockOutCorrectionId: input.correctionEntryIds.clockOutCorrectionId,
				},
			}
		: undefined;

	return ensureNoPendingTimeCorrectionApproval(dbService, input.workPeriodId).pipe(
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

function ensureNoPendingTimeCorrectionApproval(dbService: ApprovalDbService, workPeriodId: string) {
	return dbService
		.query("getPendingTimeCorrectionApproval", async () => {
			return await dbService.db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, workPeriodId),
					eq(approvalRequest.status, "pending"),
				),
			});
		})
		.pipe(
			Effect.flatMap((pendingApproval) =>
				pendingApproval
					? Effect.fail(pendingTimeCorrectionConflict(workPeriodId))
					: Effect.void,
			),
		);
}

export async function syncCanonicalWorkCorrection(input: {
	organizationId: string;
	canonicalRecordId: string | null;
	startAt: Date;
	endAt: Date | null;
	durationMinutes: number | null;
	updatedBy: string;
}): Promise<void> {
	if (!input.canonicalRecordId) {
		return;
	}

	await db
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
	clockIn: CorrectionEntry,
	clockOut: CorrectionEntry | null,
) {
	if (clockOut) {
		return {
			endTime: clockOut.timestamp,
			durationMinutes: calculateCorrectedDurationMinutes(clockIn.timestamp, clockOut.timestamp),
			clockOutId: clockOut.id,
		};
	}

	if (period.endTime) {
		return {
			endTime: period.endTime,
			durationMinutes: calculateCorrectedDurationMinutes(clockIn.timestamp, period.endTime),
			clockOutId: period.clockOutId,
		};
	}

	return {
		endTime: period.endTime,
		durationMinutes: null,
		clockOutId: period.clockOutId,
	};
}

function validateCorrectedPeriodRange(clockIn: CorrectionEntry, effectiveClockOut: Date | null) {
	if (effectiveClockOut && effectiveClockOut <= clockIn.timestamp) {
		return Effect.fail(
			new ValidationError({
				message: "Clock out time must be after clock in time",
				field: "clockOut",
			}),
		);
	}

	return Effect.void;
}

function applyTimeCorrection(
	dbService: ApprovalDbService,
	entityId: string,
	clockInCorrection: CorrectionEntry,
	correctedPeriod: ReturnType<typeof calculateCorrectedPeriod>,
) {
	return dbService.query("applyTimeCorrection", async () => {
		await dbService.db
			.update(workPeriod)
			.set({
				clockInId: clockInCorrection.id,
				clockOutId: correctedPeriod.clockOutId,
				startTime: clockInCorrection.timestamp,
				endTime: correctedPeriod.endTime,
				durationMinutes: correctedPeriod.durationMinutes,
				updatedAt: new Date(),
			})
			.where(eq(workPeriod.id, entityId));
	});
}

function activateApprovedTimeCorrectionEntries(
	dbService: ApprovalDbService,
	period: WorkPeriodRecord,
	clockInCorrection: CorrectionEntry,
	clockOutCorrection: CorrectionEntry | null,
) {
	return dbService.query("activateApprovedTimeCorrectionEntries", async () => {
		const correctionEntryIds = [clockInCorrection.id, clockOutCorrection?.id].filter(
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

function getDirtyFromDateForCorrection(period: WorkPeriodRecord, clockInCorrection: CorrectionEntry) {
	const dirtyFromDateSource =
		period.startTime.getTime() <= clockInCorrection.timestamp.getTime()
			? period.startTime
			: clockInCorrection.timestamp;
	return DateTime.fromJSDate(dirtyFromDateSource, { zone: "utc" }).toISODate() ?? undefined;
}

function markWorkBalanceDirtyAfterCommit(mark?: WorkBalanceDirtyMark) {
	return mark
		? Effect.promise(() => markEmployeeWorkBalanceDirtyIfNeeded(mark))
		: Effect.void;
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
	clockInCorrection: CorrectionEntry,
) {
	void onTimeCorrectionApproved({
		workPeriodId: entityId,
		employeeUserId: period.employee.userId,
		employeeName: period.employee.user.name,
		organizationId: period.employee.organizationId,
		originalTime: period.startTime,
		correctedTime: clockInCorrection.timestamp,
		approverName: currentEmployee.user.name,
	});
}

function notifyRejectedCorrection(
	period: WorkPeriodRecord,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
) {
	void onTimeCorrectionRejected({
		workPeriodId: entityId,
		employeeUserId: period.employee.userId,
		employeeName: period.employee.user.name,
		organizationId: period.employee.organizationId,
		originalTime: period.startTime,
		correctedTime: period.startTime,
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
		const originalEntryIds = [period.clockInId, period.clockOutId].filter((id): id is string => Boolean(id));
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
		const period = yield* _(loadWorkPeriod(dbService, entityId));
		const correctionEntryIds = correctionEntryIdsFromApproval(approval);
		const linkedClockInCorrection = yield* _(
			resolveCorrectionEntryForApproval(
				dbService,
				period,
				correctionEntryIds?.clockInCorrectionId,
				period.clockInId,
				!correctionEntryIds,
			),
		);
		const clockInCorrection = yield* _(
			ensureClockInCorrection(linkedClockInCorrection as CorrectionEntry | undefined),
		);
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
		yield* _(validateCorrectedPeriodRange(clockInCorrection, clockOutCorrection?.timestamp ?? period.endTime));
		const correctedPeriod = calculateCorrectedPeriod(period, clockInCorrection, clockOutCorrection);

		yield* _(activateApprovedTimeCorrectionEntries(dbService, period, clockInCorrection, clockOutCorrection));
		yield* _(applyTimeCorrection(dbService, entityId, clockInCorrection, correctedPeriod));
		const workBalanceDirtyMark = {
			employeeId: period.employeeId,
			organizationId: period.organizationId,
			dirtyFromDate: getDirtyFromDateForCorrection(period, clockInCorrection),
		};
		yield* _(
			Effect.promise(() =>
				syncCanonicalWorkCorrection({
					organizationId: period.organizationId,
					canonicalRecordId: period.canonicalRecordId,
					startAt: clockInCorrection.timestamp,
					endAt: correctedPeriod.endTime,
					durationMinutes: correctedPeriod.durationMinutes,
					updatedBy: currentEmployee.user.id,
				}),
			),
		);
		notifyApprovedCorrection(period, entityId, currentEmployee, clockInCorrection);

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
		const period = yield* _(loadWorkPeriod(dbService, entityId));
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
		notifyRejectedCorrection(period, entityId, currentEmployee, reason);
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
