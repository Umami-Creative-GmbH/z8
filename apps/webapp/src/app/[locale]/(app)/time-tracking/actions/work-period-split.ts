import "server-only";

/**
 * Calendar split of the owner's completed work (#304 / T40). Both calendar
 * entry points (`splitWorkPeriod` in `../actions` and in `./mutations`) are
 * thin adapters of this one caller.
 *
 * Every organization splits inside the coordinated completed-work transaction
 * and is refused while the period has unresolved review. Organizations whose
 * append control is active run the completed-work split operation (append,
 * canonical graph, revisions, receipt); the others keep their established
 * legacy entry writes while dividing the canonical graph with the work.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db";
import {
	timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import { carryInvoicedWorkToSplit } from "@/lib/billable-time/hand-off/invoiced-work";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	CompletedWorkReviewRequiredError,
	describeAmendmentFailure,
} from "@/lib/time-tracking/amend-completed-work";
import { localizeMonthClosed } from "@/lib/time-tracking/closed-months/refusal-message";
import { workInterval } from "@/lib/time-tracking/closed-months/store";
import { withCompletedWorkTransaction } from "@/lib/time-tracking/completed-work-transaction";
import { sendBackChangedPeriodSubmissions } from "@/lib/time-tracking/period-submissions/submission-send-back";
import {
	replayCommittedSplit,
	replaySplitCompletedWork,
	SPLIT_COMPLETED_WORK_COMMAND_VERSION,
	type SplitCompletedWorkCommand,
	type SplitCompletedWorkResult,
	splitCompletedWork,
} from "@/lib/time-tracking/split-completed-work";
import { resolveWorkPeriodSplit } from "@/lib/time-tracking/split-work-period";
import {
	createTimeEntry,
	type TimeEntryRequestMetadata,
} from "@/lib/time-tracking/time-entry-writer";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
import {
	sameWorkVehicleUse,
	vehicleUseColumns,
	vehicleUseFromColumns,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import {
	resolveWorkVehicleUseSplit,
	workVehicleUseRefusalCodeOf,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use-eligibility";
import { WorkIntervalError } from "@/lib/time-tracking/work-duration";
import { assertNoUnresolvedWorkPeriodReview } from "@/lib/time-tracking/work-period-review";
import type { SealedWorkTransactionScope } from "@/lib/time-tracking/work-transaction";
import { getCurrentEmployee, getCurrentSession, getRequestMetadata, getUserTimezone } from "./auth";
import { calculateAndPersistSurcharges } from "./compliance";
import { logger } from "./shared";

export type SplitWorkPeriodResult = ServerActionResult<{
	firstPeriodId: string;
	secondPeriodId: string;
}>;

export type SplitWorkPeriodRequest = {
	workPeriodId: string;
	splitDateKey: string;
	/** Wall-clock `HH:mm` in the owner's timezone setting. */
	splitTime: string;
	beforeNotes?: string;
	afterNotes?: string;
	disambiguation?: "earlier" | "later";
	/**
	 * Identity of this split attempt. A retry with the same identity replays the
	 * committed split instead of splitting again; without one the server
	 * generates an identity that names the operation but cannot recognize a retry.
	 */
	submissionId?: string;
	/**
	 * The one value asked at the split of work with vehicle use (#1126): the
	 * odometer reading at the split, or the first half's km of a directly entered
	 * distance. Omitted when skipped.
	 */
	vehicleSplitKm?: number;
};

const submissionIdSchema = z.uuid();

const FAILED = "Failed to split work period. Please try again.";

function committedResponse(result: SplitCompletedWorkResult): SplitWorkPeriodResult {
	const [retained, generated] = result.segments;
	return {
		success: true,
		data: {
			firstPeriodId: retained.workPeriodId,
			secondPeriodId: generated.workPeriodId,
		},
	};
}

/** Operation and guard refusals as the user-facing message; null for unexpected failures. */
async function describeSplitFailure(
	error: unknown,
): Promise<{ error: string; code?: string } | null> {
	if (error instanceof ConflictError) {
		return { error: error.message, code: error.conflictType };
	}
	if (error instanceof ValidationError) {
		const refusal = workVehicleUseRefusalCodeOf(error);
		return refusal ? { error: error.message, code: refusal } : { error: error.message };
	}
	if (error instanceof NotFoundError) return { error: "Work period not found" };
	if (error instanceof WorkIntervalError) {
		return {
			error: "Split time must be between work period start and end times",
		};
	}
	const failure = await localizeMonthClosed(describeAmendmentFailure(error));
	return failure ? { error: failure.message, code: failure.code } : null;
}

export async function splitOwnWorkPeriod(
	request: SplitWorkPeriodRequest,
): Promise<SplitWorkPeriodResult> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}
	if (
		request.submissionId !== undefined &&
		!submissionIdSchema.safeParse(request.submissionId).success
	) {
		return { success: false, error: FAILED };
	}
	const actorUserId = session.user.id;
	const { organizationId } = currentEmployee;
	const command: SplitCompletedWorkCommand = {
		version: SPLIT_COMPLETED_WORK_COMMAND_VERSION,
		operationId: request.submissionId ?? randomUUID(),
		request: {
			workPeriodId: request.workPeriodId,
			splitDate: request.splitDateKey,
			splitTime: request.splitTime,
			disambiguation: request.disambiguation ?? null,
			beforeNotes: request.beforeNotes ?? null,
			afterNotes: request.afterNotes ?? null,
			// Only when given: earlier commands stay byte-identical for replay (#1126).
			...(request.vehicleSplitKm !== undefined && request.vehicleSplitKm !== null
				? { vehicleSplitKm: request.vehicleSplitKm }
				: {}),
		},
	};

	try {
		// A committed split replays before any fresh preflight: its own commit has
		// already changed the period the preflight reads.
		if (request.submissionId !== undefined) {
			const committed = await replayCommittedSplit({
				organizationId,
				actorUserId,
				command,
			});
			if (committed) return committedResponse(committed.result);
		}

		const timezone = await getUserTimezone(actorUserId);
		const [selectedWorkPeriod] = await db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, request.workPeriodId),
					eq(workPeriod.employeeId, currentEmployee.id),
					eq(workPeriod.organizationId, organizationId),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);
		if (!selectedWorkPeriod) {
			return { success: false, error: "Work period not found" };
		}
		const { endTime, clockOutId } = selectedWorkPeriod;
		if (!endTime || !clockOutId) {
			return { success: false, error: "Cannot split an active work period" };
		}

		const resolvedSplit = resolveWorkPeriodSplit({
			startTime: selectedWorkPeriod.startTime,
			endTime,
			splitDate: request.splitDateKey,
			splitTime: request.splitTime,
			timezone,
			disambiguation: request.disambiguation,
		});
		if (!resolvedSplit.success) {
			return {
				success: false,
				error:
					resolvedSplit.code === "ambiguous"
						? "Split time is ambiguous"
						: resolvedSplit.code === "nonexistent"
							? "Split time does not exist on this date"
							: "Split time must be between work period start and end times",
			};
		}
		const splitAtDate = resolvedSplit.splitTime;

		const validation = await validateTimeEntryRange(
			organizationId,
			selectedWorkPeriod.startTime,
			endTime,
		);
		if (!validation.isValid) {
			return {
				success: false,
				error: validation.error || "Cannot split work period",
				holidayName: validation.holidayName,
			};
		}
		const billingAccess = await requireBillingForMutation(organizationId);
		if (!isBillingMutationAllowed(billingAccess)) {
			return {
				success: false,
				error: "billing_required",
				code: billingAccess.reason ?? "subscription_required",
			};
		}
		const splitTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: splitAtDate,
			timezone,
			timezoneSource: "user_setting",
		});
		const { ipAddress, userAgent } = await getRequestMetadata();

		const outcome = await withCompletedWorkTransaction(
			{ organizationId, employeeId: currentEmployee.id, actorUserId },
			async (scope) => {
				if (scope.admission === "append") {
					const replayed = await replaySplitCompletedWork(scope, {
						organizationId,
						employeeId: currentEmployee.id,
						actorUserId,
						command,
					});
					if (replayed) return { kind: "operation" as const, receipt: replayed };
					return {
						kind: "operation" as const,
						receipt: await splitCompletedWork(scope, {
							organizationId,
							employeeId: currentEmployee.id,
							actorUserId,
							command,
							splitAt: instantFromDate(splitAtDate),
							capture: splitTimezoneCapture,
							expectedSource: {
								clockInId: selectedWorkPeriod.clockInId,
								clockOutId,
								startAt: instantFromDate(selectedWorkPeriod.startTime),
								endAt: instantFromDate(endTime),
							},
							request: { ipAddress, deviceInfo: userAgent },
						}),
					};
				}
				return {
					kind: "legacy" as const,
					...(await splitLegacyWorkPeriod(scope, {
						organizationId,
						employeeId: currentEmployee.id,
						actorUserId,
						period: selectedWorkPeriod,
						splitAtDate,
						splitTimezoneCapture,
						durations: resolvedSplit,
						beforeNotes: request.beforeNotes,
						afterNotes: request.afterNotes,
						vehicleSplitKm: request.vehicleSplitKm,
						request: { ipAddress, userAgent },
					})),
				};
			},
		);

		if (outcome.kind === "legacy") {
			logger.info(
				{
					originalPeriodId: request.workPeriodId,
					firstPeriodId: outcome.firstPeriodId,
					secondPeriodId: outcome.secondPeriodId,
					splitTime: request.splitTime,
				},
				"Work period split successfully",
			);
			return {
				success: true,
				data: {
					firstPeriodId: outcome.firstPeriodId,
					secondPeriodId: outcome.secondPeriodId,
				},
			};
		}
		if (outcome.receipt.disposition === "executed") {
			// Post-commit best effort, recorded as such in the receipt; replays repeat no effects.
			for (const segment of outcome.receipt.result.segments) {
				await calculateAndPersistSurcharges(segment.workPeriodId, organizationId);
			}
		}
		return committedResponse(outcome.receipt.result);
	} catch (error) {
		const failure = await describeSplitFailure(error);
		if (failure) {
			logger.warn({ error }, "Split work period refused");
			return { success: false, ...failure };
		}
		logger.error({ error }, "Split work period error");
		return { success: false, error: FAILED };
	}
}

/**
 * The legacy split of organizations that have not adopted,
 * now inside the coordinated transaction and behind the unresolved-review guard.
 */
async function splitLegacyWorkPeriod(
	scope: SealedWorkTransactionScope,
	input: {
		organizationId: string;
		employeeId: string;
		actorUserId: string;
		period: typeof workPeriod.$inferSelect;
		splitAtDate: Date;
		splitTimezoneCapture: ReturnType<typeof resolveFallbackTimezoneCapture>;
		durations: { firstDurationMinutes: number; secondDurationMinutes: number };
		beforeNotes?: string;
		afterNotes?: string;
		vehicleSplitKm?: number;
		request: TimeEntryRequestMetadata;
	},
): Promise<{ firstPeriodId: string; secondPeriodId: string }> {
	const { organizationId, employeeId, period } = input;
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;
	const [locked] = await tx
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				isNull(workPeriod.deletedAt),
			),
		)
		.for("update");
	if (!locked) {
		throw new NotFoundError({
			message: "Work period not found",
			entityType: "workPeriod",
			entityId: period.id,
		});
	}
	if (
		locked.clockInId !== period.clockInId ||
		locked.clockOutId !== period.clockOutId ||
		locked.startTime.getTime() !== period.startTime.getTime() ||
		locked.endTime?.getTime() !== period.endTime?.getTime()
	) {
		throw new ConflictError({
			message: "Work period changed while editing",
			conflictType: "time_correction_work_period_stale",
		});
	}
	await assertNoUnresolvedWorkPeriodReview(tx, organizationId, locked);
	// The vehicle carries over to both halves; the value at the split divides the km (#1126).
	const vehicleSplit = await resolveWorkVehicleUseSplit(tx, {
		organizationId,
		employeeId,
		workPeriodId: locked.id,
		use: vehicleUseFromColumns(locked),
		value: input.vehicleSplitKm,
	});
	const retainedVehicle = vehicleUseColumns(vehicleSplit.retained);
	const generatedVehicle = vehicleUseColumns(vehicleSplit.generated);

	// Keep the source graph scoped and locked before dividing its canonical work (#1205).
	let canonical: {
		record: typeof timeRecord.$inferSelect;
		detail: typeof timeRecordWork.$inferSelect;
		allocations: Array<typeof timeRecordAllocation.$inferSelect>;
	} | null = null;
	if (locked.canonicalRecordId) {
		const [record] = await tx
			.select()
			.from(timeRecord)
			.where(
				and(
					eq(timeRecord.id, locked.canonicalRecordId),
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.employeeId, employeeId),
					eq(timeRecord.recordKind, "work"),
				),
			)
			.for("update");
		const [detail] = await tx
			.select()
			.from(timeRecordWork)
			.where(
				and(
					eq(timeRecordWork.recordId, locked.canonicalRecordId),
					eq(timeRecordWork.organizationId, organizationId),
					eq(timeRecordWork.recordKind, "work"),
				),
			)
			.for("update");
		const allocations = await tx
			.select()
			.from(timeRecordAllocation)
			.where(
				and(
					eq(timeRecordAllocation.recordId, locked.canonicalRecordId),
					eq(timeRecordAllocation.organizationId, organizationId),
				),
			)
			.orderBy(asc(timeRecordAllocation.id))
			.for("update");
		if (
			record &&
			detail &&
			record.endAt &&
			record.startAt.getTime() === locked.startTime.getTime() &&
			record.endAt.getTime() === locked.endTime?.getTime() &&
			detail.workLocationType === locked.workLocationType &&
			detail.workCategoryId === locked.workCategoryId &&
			sameWorkVehicleUse(vehicleUseFromColumns(detail), vehicleUseFromColumns(locked))
		) {
			canonical = { record, detail, allocations };
		} else {
			throw new CompletedWorkReviewRequiredError("canonical_divergence");
		}
	}

	const firstClockOut = await createTimeEntry(
		{
			employeeId,
			organizationId,
			type: "clock_out",
			timestamp: input.splitAtDate,
			createdBy: input.actorUserId,
			...input.splitTimezoneCapture,
			request: input.request,
			notes: input.beforeNotes,
		},
		tx,
	);
	const secondClockIn = await createTimeEntry(
		{
			employeeId,
			organizationId,
			type: "clock_in",
			timestamp: input.splitAtDate,
			createdBy: input.actorUserId,
			...input.splitTimezoneCapture,
			request: input.request,
			notes: input.afterNotes,
		},
		tx,
	);
	if (input.beforeNotes && locked.clockOutId) {
		await tx
			.update(timeEntry)
			.set({ isSuperseded: true, supersededById: firstClockOut.id })
			.where(
				and(
					eq(timeEntry.id, locked.clockOutId),
					eq(timeEntry.organizationId, organizationId),
					eq(timeEntry.employeeId, employeeId),
				),
			);
	}
	await tx
		.update(workPeriod)
		.set({
			clockOutId: firstClockOut.id,
			endTime: input.splitAtDate,
			durationMinutes: input.durations.firstDurationMinutes,
			odometerStartKm: retainedVehicle.odometerStartKm,
			odometerEndKm: retainedVehicle.odometerEndKm,
			drivenDistanceKm: retainedVehicle.drivenDistanceKm,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(workPeriod.id, locked.id),
				eq(workPeriod.organizationId, organizationId),
				isNull(workPeriod.deletedAt),
			),
		);
	let generatedRecordId: string | null = null;
	if (canonical) {
		const updatedRecords = await tx
			.update(timeRecord)
			.set({
				endAt: input.splitAtDate,
				durationMinutes: input.durations.firstDurationMinutes,
				updatedAt: new Date(),
				updatedBy: input.actorUserId,
			})
			.where(
				and(
					eq(timeRecord.id, canonical.record.id),
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.employeeId, employeeId),
					eq(timeRecord.recordKind, "work"),
				),
			)
			.returning({ id: timeRecord.id });
		if (updatedRecords.length !== 1) {
			throw new Error("Canonical work record update failed");
		}
		if (vehicleUseFromColumns(locked)) {
			const updatedDetails = await tx
				.update(timeRecordWork)
				.set({
					odometerStartKm: retainedVehicle.odometerStartKm,
					odometerEndKm: retainedVehicle.odometerEndKm,
					drivenDistanceKm: retainedVehicle.drivenDistanceKm,
				})
				.where(
					and(
						eq(timeRecordWork.recordId, canonical.record.id),
						eq(timeRecordWork.organizationId, organizationId),
						eq(timeRecordWork.recordKind, "work"),
					),
				)
				.returning({ recordId: timeRecordWork.recordId });
			if (updatedDetails.length !== 1) {
				throw new Error("Canonical work detail update failed");
			}
		}
		// The generated record keeps the originating work's origin, approval state and
		// recording actor; no new decision is recorded for it.
		generatedRecordId = randomUUID();
		await tx.insert(timeRecord).values({
			id: generatedRecordId,
			organizationId,
			employeeId,
			recordKind: "work",
			startAt: input.splitAtDate,
			endAt: locked.endTime,
			durationMinutes: input.durations.secondDurationMinutes,
			approvalState: canonical.record.approvalState,
			origin: canonical.record.origin,
			createdBy: canonical.record.createdBy,
			updatedAt: new Date(),
			updatedBy: input.actorUserId,
		});
		await tx.insert(timeRecordWork).values({
			recordId: generatedRecordId,
			organizationId,
			recordKind: "work",
			workCategoryId: canonical.detail.workCategoryId,
			workLocationType: canonical.detail.workLocationType,
			computationMetadata: canonical.detail.computationMetadata,
			vehicleKind: generatedVehicle.vehicleKind,
			vehicleId: generatedVehicle.vehicleId,
			odometerStartKm: generatedVehicle.odometerStartKm,
			odometerEndKm: generatedVehicle.odometerEndKm,
			drivenDistanceKm: generatedVehicle.drivenDistanceKm,
		});
		for (const allocation of canonical.allocations) {
			await tx.insert(timeRecordAllocation).values({
				organizationId,
				recordId: generatedRecordId,
				allocationKind: allocation.allocationKind,
				projectId: allocation.projectId,
				taskId: allocation.taskId,
				costCenterId: allocation.costCenterId,
				weightPercent: allocation.weightPercent,
				isBillable: allocation.isBillable,
			});
		}
	}
	const [secondWorkPeriod] = await tx
		.insert(workPeriod)
		.values({
			employeeId,
			organizationId,
			clockInId: secondClockIn.id,
			clockOutId: locked.clockOutId,
			startTime: input.splitAtDate,
			endTime: locked.endTime,
			durationMinutes: input.durations.secondDurationMinutes,
			isActive: false,
			// Both halves keep the source's project and billability (#900).
			projectId: locked.projectId,
			isBillable: locked.isBillable,
			taskId: locked.taskId,
			workCategoryId: locked.workCategoryId,
			workLocationType: locked.workLocationType,
			approvalStatus: locked.approvalStatus,
			canonicalRecordId: generatedRecordId,
			vehicleKind: generatedVehicle.vehicleKind,
			vehicleId: generatedVehicle.vehicleId,
			odometerStartKm: generatedVehicle.odometerStartKm,
			odometerEndKm: generatedVehicle.odometerEndKm,
			drivenDistanceKm: generatedVehicle.drivenDistanceKm,
		})
		.returning();
	if (!secondWorkPeriod) throw new Error("Second work period insert failed");
	// Splitting work in a submitted period sends it back to the employee (#805).
	await sendBackChangedPeriodSubmissions(tx, {
		organizationId,
		employeeId,
		causedByUserId: input.actorUserId,
		work: [workInterval(locked.startTime, locked.endTime)],
	});
	// Invoiced work stays invoiced in both halves; the source is marked by trigger (#903).
	await carryInvoicedWorkToSplit(tx, {
		organizationId,
		sourceWorkPeriodId: locked.id,
		newWorkPeriodId: secondWorkPeriod.id,
	});
	if (input.afterNotes && locked.clockOutId) {
		await tx
			.update(timeEntry)
			.set({ notes: input.afterNotes })
			.where(
				and(
					eq(timeEntry.id, locked.clockOutId),
					eq(timeEntry.organizationId, organizationId),
					eq(timeEntry.employeeId, employeeId),
				),
			);
	}
	return { firstPeriodId: locked.id, secondPeriodId: secondWorkPeriod.id };
}
