import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { approvalRequest, timeEntry, timeRecord, workPeriod } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type AnyAppError, ConflictError, NotFoundError } from "@/lib/effect/errors";
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
import type { ApprovalDbService, CurrentApprover } from "./types";

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

function loadClockInCorrectionEntries(dbService: ApprovalDbService, period: WorkPeriodRecord) {
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
						eq(timeEntry.replacesEntryId, period.clockInId),
						eq(timeEntry.isSuperseded, false),
					),
				);
		})
		.pipe(Effect.map((entries) => (entries as CorrectionEntry[]).filter((entry) => !entry.isSuperseded)));
}

function loadClockOutCorrection(dbService: ApprovalDbService, period: WorkPeriodRecord) {
	return dbService
		.query("getClockOutCorrection", async () => {
			if (!period.clockOutId) {
				return null;
			}

			return await dbService.db.query.timeEntry.findFirst({
				where: and(
					eq(timeEntry.type, "correction"),
					eq(timeEntry.employeeId, period.employeeId),
					eq(timeEntry.organizationId, period.organizationId),
					eq(timeEntry.replacesEntryId, period.clockOutId),
					eq(timeEntry.isSuperseded, false),
				),
			});
		})
		.pipe(
			Effect.map((entry) => {
				const correction = entry as CorrectionEntry | null;
				return correction?.isSuperseded ? null : correction;
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
	},
): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> {
	return ensureNoPendingTimeCorrectionApproval(dbService, input.workPeriodId).pipe(
		Effect.flatMap(() =>
			resolvePolicyAndCreateApproval(dbService, {
				context: buildTimeCorrectionApprovalPolicyContext(input),
				defaultApproverId: input.defaultApproverId,
				reason: input.reason,
			}),
		),
		Effect.catchTag("ValidationError", () =>
			dbService.query("createDefaultTimeCorrectionApprovalFallback", async () => {
				const [approval] = await dbService.db
					.insert(approvalRequest)
					.values({
						organizationId: input.organizationId,
						entityType: "time_entry",
						entityId: input.workPeriodId,
						requestedBy: input.requesterEmployeeId,
						approverId: input.defaultApproverId,
						status: "pending",
						reason: input.reason,
					})
					.returning({ id: approvalRequest.id });

				return { kind: "default_created" as const, approvalRequestId: approval?.id ?? input.workPeriodId };
			}),
		),
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
					? Effect.fail(
							new ConflictError({
								message: "A time correction approval is already pending for this work period",
								conflictType: "pending_time_correction_approval",
								details: { workPeriodId },
							}),
						)
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
		(decisionDbService, entityId, approver) =>
			handleRejectedTimeCorrection(decisionDbService, entityId, approver, reason),
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
) {
	return dbService.query("rollbackRejectedTimeCorrection", async () => {
		const originalEntryIds = [period.clockInId, period.clockOutId].filter((id): id is string => Boolean(id));
		const correctionEntryIds = correctionEntries.map((entry) => entry.id);

		if (originalEntryIds.length > 0) {
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
) {
	return Effect.gen(function* (_) {
		const period = yield* _(loadWorkPeriod(dbService, entityId));
		const correctionEntries = yield* _(loadClockInCorrectionEntries(dbService, period));
		const clockInCorrection = yield* _(
			ensureClockInCorrection(
				correctionEntries.find((entry) => entry.replacesEntryId === period.clockInId),
			),
		);
		const clockOutCorrection = yield* _(loadClockOutCorrection(dbService, period));
		const correctedPeriod = calculateCorrectedPeriod(period, clockInCorrection, clockOutCorrection);

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
) {
	return Effect.gen(function* (_) {
		const period = yield* _(loadWorkPeriod(dbService, entityId));
		const clockInCorrections = yield* _(loadClockInCorrectionEntries(dbService, period));
		const clockOutCorrection = yield* _(loadClockOutCorrection(dbService, period));
		const correctionEntries = clockOutCorrection
			? [...clockInCorrections, clockOutCorrection]
			: clockInCorrections;

		yield* _(rollbackRejectedTimeCorrection(dbService, period, correctionEntries));
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
		(dbService, entityId, currentEmployee) =>
			handleRejectedTimeCorrection(dbService, entityId, currentEmployee, reason),
		undefined,
		{ transactional: true },
	);

	if (!result) return { success: true, data: undefined };
	return result.success ? { success: true, data: undefined } : result;
}
