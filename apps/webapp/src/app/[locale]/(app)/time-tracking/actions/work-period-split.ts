import "server-only";

/**
 * Calendar split of the owner's completed work (#304 / T40). Both calendar
 * entry points (`splitWorkPeriod` in `../actions` and in `./mutations`) are
 * thin adapters of this one caller.
 *
 * Every organization splits inside the coordinated completed-work transaction
 * through the one completed-work split, which hides admission (#1231): work
 * records divides the work period and its canonical work record (ADR 0010) with
 * the writer of the organization's admission, and the split commits and replays
 * a receipt where work records appended the entries.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { describeAmendmentFailure } from "@/lib/time-tracking/amend-completed-work";
import { localizeMonthClosed } from "@/lib/time-tracking/closed-months/refusal-message";
import { withCompletedWorkTransaction } from "@/lib/time-tracking/completed-work-transaction";
import {
	replayCommittedSplit,
	SPLIT_COMPLETED_WORK_COMMAND_VERSION,
	type SplitCompletedWorkCommand,
	type SplitCompletedWorkInput,
	type SplitCompletedWorkOutcome,
	splitCompletedWork,
} from "@/lib/time-tracking/split-completed-work";
import { resolveWorkPeriodSplit } from "@/lib/time-tracking/split-work-period";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
import { workVehicleUseRefusalCodeOf } from "@/lib/time-tracking/vehicle-use/work-vehicle-use-eligibility";
import { WorkIntervalError } from "@/lib/time-tracking/work-duration";
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

function committedResponse(outcome: SplitCompletedWorkOutcome): SplitWorkPeriodResult {
	return {
		success: true,
		data: {
			firstPeriodId: outcome.retainedWorkPeriodId,
			secondPeriodId: outcome.generatedWorkPeriodId,
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
			if (committed) return committedResponse(committed);
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

		const splitInput: SplitCompletedWorkInput = {
			organizationId,
			employeeId: currentEmployee.id,
			actorUserId,
			command,
			splitAt: instantFromDate(splitAtDate),
			capture: splitTimezoneCapture,
			// The work as shown; any change since is a stale source.
			expected: {
				workPeriodId: selectedWorkPeriod.id,
				revision: selectedWorkPeriod.graphRevision,
				clockInId: selectedWorkPeriod.clockInId,
				clockOutId,
				startAt: instantFromDate(selectedWorkPeriod.startTime),
				endAt: instantFromDate(endTime),
			},
			request: { ipAddress, deviceInfo: userAgent },
		};
		const outcome = await withCompletedWorkTransaction(
			{ organizationId, employeeId: currentEmployee.id, actorUserId },
			(scope) => splitCompletedWork(scope, splitInput),
		);
		if (outcome.disposition === "executed") {
			// Post-commit best effort (recorded as such in a receipt); replays repeat no effects.
			for (const workPeriodId of [outcome.retainedWorkPeriodId, outcome.generatedWorkPeriodId]) {
				await calculateAndPersistSurcharges(workPeriodId, organizationId);
			}
		}
		return committedResponse(outcome);
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

