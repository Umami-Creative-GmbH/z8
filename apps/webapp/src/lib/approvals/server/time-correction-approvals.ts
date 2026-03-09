import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { timeEntry, timeRecord, workPeriod } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type AnyAppError, NotFoundError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { onTimeCorrectionApproved, onTimeCorrectionRejected } from "@/lib/notifications/triggers";
import { processApproval } from "./shared";
import type { ApprovalDbService, CurrentApprover } from "./types";

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
}

function ensureWorkPeriod(period: WorkPeriodRecord | null): Effect.Effect<WorkPeriodRecord, NotFoundError> {
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
	return dbService.query("getWorkPeriod", async () => {
		return await dbService.db.query.workPeriod.findFirst({
			where: eq(workPeriod.id, entityId),
			with: {
				employee: {
					with: { user: true },
				},
			},
		});
	}).pipe(Effect.flatMap((period) => ensureWorkPeriod(period as unknown as WorkPeriodRecord | null)));
}

function loadClockInCorrectionEntries(dbService: ApprovalDbService, period: WorkPeriodRecord) {
	return dbService.query("getCorrectionEntries", async () => {
		return await dbService.db
			.select()
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.type, "correction"),
					eq(timeEntry.employeeId, period.employeeId),
					eq(timeEntry.replacesEntryId, period.clockInId),
				),
			);
	}).pipe(Effect.map((entries) => entries as CorrectionEntry[]));
}

function loadClockOutCorrection(dbService: ApprovalDbService, period: WorkPeriodRecord) {
	return dbService.query("getClockOutCorrection", async () => {
		if (!period.clockOutId) {
			return null;
		}

		return await dbService.db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.type, "correction"),
				eq(timeEntry.replacesEntryId, period.clockOutId),
			),
		});
	}).pipe(Effect.map((entry) => entry as CorrectionEntry | null));
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

		return period;
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
		notifyRejectedCorrection(period, entityId, currentEmployee, reason);
		return period;
	});
}

export async function approveTimeCorrectionEffect(
	workPeriodId: string,
): Promise<ServerActionResult<void>> {
	return processApproval(
		"time_entry",
		workPeriodId,
		"approve",
		undefined,
		handleApprovedTimeCorrection,
	);
}

export async function rejectTimeCorrectionEffect(
	workPeriodId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	return processApproval(
		"time_entry",
		workPeriodId,
		"reject",
		reason,
		(dbService, entityId, currentEmployee) =>
			handleRejectedTimeCorrection(dbService, entityId, currentEmployee, reason),
	);
}
