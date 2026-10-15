import "server-only";

import { auditLog } from "@/db/schema";
import { instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import {
	AMEND_COMPLETED_WORK_COMMAND_VERSION,
	type AmendCompletedWorkCommand,
	type AmendCompletedWorkInput,
	type AmendCompletedWorkIntent,
	type AmendCompletedWorkResult,
	replayCommittedAmendment,
	replayOrAmendCompletedWork,
} from "@/lib/time-tracking/amend-completed-work";
import { withCompletedWorkTransaction } from "@/lib/time-tracking/completed-work-transaction";
import {
	instantFromTimeCorrectionBoundary,
	validateTimeCorrectionRange,
} from "@/lib/time-tracking/time-correction-temporal";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import {
	type WorkVehicleUse,
	workVehicleUseIntentOf,
	workVehicleUseRequestValue,
} from "./vehicle-use/work-vehicle-use";
import type { WorkLocationType } from "./work-location";
import type { WorkTransactionClient } from "./work-transaction";

export interface AdminWorkPeriodTimeEditInput {
	organizationId: string;
	actorUserId: string;
	workPeriodId: string;
	/** The edit's submission identity; the adopted operation's receipt ID. */
	submissionId: string;
	/** The form values exactly as submitted, before interpretation. */
	submitted: {
		workLocationType?: WorkLocationType;
		/** Vehicle use (#1120): absent keeps it, null clears it. Already validated. */
		vehicleUse?: WorkVehicleUse | null;
		clockInDate: string;
		clockInTime: string;
		clockOutDate: string;
		clockOutTime: string;
	};
	/** Snapshot the caller validated against; the edit fails if the period changed since. */
	expected: {
		workLocationType?: string | null;
		employeeId: string;
		clockInId: string;
		clockOutId: string;
		startTime: Date;
		endTime: Date;
	};
	clockIn: Date;
	clockOut: Date;
	/** Timezone the wall-clock values were entered in (the entry owner's timezone). */
	timezone: string;
	timezoneSource: "user_setting" | "manager_target_user_setting";
	notes: string;
	ipAddress: string;
	deviceInfo: string;
}

/** The edited work. Its balance refresh committed with it, in either admission. */
export interface AdminWorkPeriodTimeEditResult {
	workPeriodId: string;
	employeeId: string;
}

type AdminEditIdentity = Pick<
	AdminWorkPeriodTimeEditInput,
	"submissionId" | "workPeriodId" | "submitted" | "notes"
>;

function adminEditCommand(input: AdminEditIdentity): AmendCompletedWorkCommand {
	const { vehicleUse, ...submitted } = input.submitted;
	return {
		version: AMEND_COMPLETED_WORK_COMMAND_VERSION,
		operationId: input.submissionId,
		request: {
			workPeriodId: input.workPeriodId,
			...submitted,
			// Only when submitted, keeping earlier commands byte-identical (#1120).
			...(vehicleUse !== undefined ? { vehicleUse: workVehicleUseRequestValue(vehicleUse) } : {}),
			notes: input.notes,
		},
	};
}

/**
 * Lookup-only replay of a committed adopted admin edit, before any fresh
 * preflight. Null when nothing was committed with this submission identity.
 */
export async function replayAdminWorkPeriodTimeEdit(
	input: AdminEditIdentity & Pick<AdminWorkPeriodTimeEditInput, "organizationId" | "actorUserId">,
): Promise<AdminWorkPeriodTimeEditResult | null> {
	const receipt = await replayCommittedAmendment({
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		writer: "admin_time_edit",
		command: adminEditCommand(input),
	});
	return receipt
		? {
				workPeriodId: receipt.result.workPeriodId,
				employeeId: receipt.result.owner.employeeId,
			}
		: null;
}

function adminEditIntent(input: AdminWorkPeriodTimeEditInput): AmendCompletedWorkIntent {
	const endpoint = (timestamp: Date, original: Date) =>
		timestamp.getTime() === original.getTime()
			? { kind: "preserve" as const }
			: {
					kind: "set" as const,
					at: instantToCanonicalString(instantFromTimeCorrectionBoundary(timestamp)),
					precision: "minute" as const,
					...resolveFallbackTimezoneCapture({
						timestamp,
						timezone: input.timezone,
						timezoneSource: input.timezoneSource,
					}),
				};
	return {
		workPeriodId: input.workPeriodId,
		clockIn: endpoint(input.clockIn, input.expected.startTime),
		clockOut: endpoint(input.clockOut, input.expected.endTime),
		project: { kind: "preserve" },
		workCategory: { kind: "preserve" },
		workLocation:
			input.submitted.workLocationType === undefined
				? { kind: "preserve" }
				: { kind: "replace", id: input.submitted.workLocationType },
		...workVehicleUseIntentOf(input.submitted.vehicleUse),
		notes: input.notes,
	};
}

/**
 * Directly corrects the endpoints, work location or vehicle use of a completed
 * work period on behalf of an organization owner/admin. Both endpoints are
 * replaced in one change so an entry can be moved across days without passing
 * through an invalid intermediate range. Original entries are superseded,
 * never mutated, preserving the audit chain.
 *
 * The completed-work amendment writes through work records (#1226) and hides
 * admission (#1231): a committed receipt replays first, and a new one is
 * committed only where work records appended the entries. Either way the
 * balance refresh commits with the work.
 */
export async function applyAdminWorkPeriodTimeEdit(
	input: AdminWorkPeriodTimeEditInput,
): Promise<AdminWorkPeriodTimeEditResult> {
	try {
		validateTimeCorrectionRange(
			instantFromTimeCorrectionBoundary(input.clockIn),
			instantFromTimeCorrectionBoundary(input.clockOut),
		);
	} catch (error) {
		throw new ValidationError({
			message: error instanceof Error ? error.message : "Invalid work period range",
			field: "timestamp",
		});
	}

	return withCompletedWorkTransaction(
		{
			organizationId: input.organizationId,
			employeeId: input.expected.employeeId,
			actorUserId: input.actorUserId,
		},
		async (scope) => {
			const amendment: AmendCompletedWorkInput = {
				organizationId: input.organizationId,
				employeeId: input.expected.employeeId,
				actorUserId: input.actorUserId,
				authority: "organization_admin",
				writer: "admin_time_edit",
				command: adminEditCommand(input),
				intent: adminEditIntent(input),
				expectedSource: {
					clockInId: input.expected.clockInId,
					clockOutId: input.expected.clockOutId,
					startAt: instantFromTimeCorrectionBoundary(input.expected.startTime),
					endAt: instantFromTimeCorrectionBoundary(input.expected.endTime),
				},
				evaluatedAt: systemClock.nowInstant(),
				request: { ipAddress: input.ipAddress, deviceInfo: input.deviceInfo },
			};
			const receipt = await replayOrAmendCompletedWork(scope, amendment);
			// A replay recorded its audit row when it was executed.
			if (receipt.disposition === "executed") {
				await recordAttributionAudit(scope.db, input, receipt.result);
			}
			return {
				workPeriodId: receipt.result.workPeriodId,
				employeeId: input.expected.employeeId,
			};
		},
	);
}

/**
 * The audit row of a location or vehicle-use change, in either admission
 * (#1226): what the work held before and after, the reason and the request.
 */
async function recordAttributionAudit(
	tx: WorkTransactionClient,
	input: AdminWorkPeriodTimeEditInput,
	result: AmendCompletedWorkResult,
): Promise<void> {
	const { changes, source, segment } = result;
	if (!changes.workLocation && !changes.vehicleUse) return;
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "work_period",
		entityId: result.workPeriodId,
		action: "update",
		performedBy: input.actorUserId,
		employeeId: result.owner.employeeId,
		changes: JSON.stringify({
			...(changes.workLocation
				? {
						workLocationType: {
							before: source.attribution.workLocationType,
							after: segment.attribution.workLocationType,
						},
					}
				: {}),
			...(changes.vehicleUse
				? {
						vehicleUse: {
							before: source.attribution.vehicleUse ?? null,
							after: segment.attribution.vehicleUse ?? null,
						},
					}
				: {}),
		}),
		metadata: JSON.stringify({ reason: input.notes }),
		ipAddress: input.ipAddress,
		userAgent: input.deviceInfo,
	});
}
