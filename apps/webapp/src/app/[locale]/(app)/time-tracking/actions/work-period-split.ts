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
 * period-only writes.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db";
import { timeEntry, workPeriod } from "@/db/schema";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { describeAmendmentFailure } from "@/lib/time-tracking/amend-completed-work";
import { withCompletedWorkTransaction } from "@/lib/time-tracking/completed-work-transaction";
import {
	replayCommittedSplit,
	replaySplitCompletedWork,
	SPLIT_COMPLETED_WORK_COMMAND_VERSION,
	type SplitCompletedWorkCommand,
	type SplitCompletedWorkResult,
	splitCompletedWork,
} from "@/lib/time-tracking/split-completed-work";
import { resolveWorkPeriodSplit } from "@/lib/time-tracking/split-work-period";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
import { WorkIntervalError } from "@/lib/time-tracking/work-duration";
import { assertNoUnresolvedWorkPeriodReview } from "@/lib/time-tracking/work-period-review";
import type { WorkTransactionScope } from "@/lib/time-tracking/work-transaction";
import { getCurrentEmployee, getCurrentSession, getRequestMetadata, getUserTimezone } from "./auth";
import { calculateAndPersistSurcharges } from "./compliance";
import { createTimeEntry } from "./entry-helpers";
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
};

const submissionIdSchema = z.uuid();

const FAILED = "Failed to split work period. Please try again.";

function committedResponse(result: SplitCompletedWorkResult): SplitWorkPeriodResult {
	const [retained, generated] = result.segments;
	return {
		success: true,
		data: { firstPeriodId: retained.workPeriodId, secondPeriodId: generated.workPeriodId },
	};
}

/** Operation and guard refusals as the user-facing message; null for unexpected failures. */
function describeSplitFailure(error: unknown): { error: string; code?: string } | null {
	if (error instanceof ConflictError) {
		return { error: error.message, code: error.conflictType };
	}
	if (error instanceof ValidationError) return { error: error.message };
	if (error instanceof NotFoundError) return { error: "Work period not found" };
	if (error instanceof WorkIntervalError) {
		return { error: "Split time must be between work period start and end times" };
	}
	const failure = describeAmendmentFailure(error);
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
		},
	};

	try {
		// A committed split replays before any fresh preflight: its own commit has
		// already changed the period the preflight reads.
		if (request.submissionId !== undefined) {
			const committed = await replayCommittedSplit({ organizationId, actorUserId, command });
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
				data: { firstPeriodId: outcome.firstPeriodId, secondPeriodId: outcome.secondPeriodId },
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
		const failure = describeSplitFailure(error);
		if (failure) {
			logger.warn({ error }, "Split work period refused");
			return { success: false, ...failure };
		}
		logger.error({ error }, "Split work period error");
		return { success: false, error: FAILED };
	}
}

/**
 * The established period-only split of organizations that have not adopted,
 * now inside the coordinated transaction and behind the unresolved-review guard.
 */
async function splitLegacyWorkPeriod(
	scope: WorkTransactionScope,
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

	const firstClockOut = await createTimeEntry(
		{
			employeeId,
			organizationId,
			type: "clock_out",
			timestamp: input.splitAtDate,
			createdBy: input.actorUserId,
			...input.splitTimezoneCapture,
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
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(workPeriod.id, locked.id),
				eq(workPeriod.organizationId, organizationId),
				isNull(workPeriod.deletedAt),
			),
		);
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
		})
		.returning();
	if (!secondWorkPeriod) throw new Error("Second work period insert failed");
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
