import "server-only";

import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import type { VehicleUseWarning } from "@/lib/time-tracking/vehicle-use/plausibility";
import {
	checkWorkVehicleUsePlausibility,
	type VehicleUseFactsReader,
} from "@/lib/time-tracking/vehicle-use/plausibility-check";
import type { TimeCorrectionSubmittedRevisionRecord } from "../evidence/store";
import {
	requestedVehicleUseChange,
	type TimeCorrectionMetadataChanges,
	type TimeCorrectionReviewMetadata,
} from "./time-correction-review-metadata";

/**
 * Adds the plausibility warnings (#1121) for the vehicle use a time correction
 * requests to its review changes, so the approver sees the same warnings the
 * employee saw on entry. They are checked over the requested work interval, now,
 * and never block a decision. Returns the changes unchanged without warnings.
 */
export async function withVehicleUseReviewWarnings(
	reader: VehicleUseFactsReader,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		metadata: TimeCorrectionReviewMetadata;
		changes: TimeCorrectionMetadataChanges | undefined;
		/** The requested interval: the corrected endpoints, or the work's own. */
		start: Date;
		end: Date | null;
	},
): Promise<TimeCorrectionMetadataChanges | undefined> {
	const { changes } = input;
	if (!changes?.vehicleUse) return changes;
	const requested = requestedVehicleUseChange(input.metadata);
	if (!requested) return changes;
	const warnings = await checkWorkVehicleUsePlausibility(reader, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		use: requested,
		start: instantFromDate(input.start),
		end: input.end ? instantFromDate(input.end) : null,
		excludeWorkPeriodId: input.workPeriodId,
	});
	return warnings.length > 0
		? { ...changes, vehicleUse: { ...changes.vehicleUse, warnings } }
		: changes;
}

/**
 * The plausibility warnings (#1121) for the vehicle use a submitted time
 * correction revision requests, for the bot approval card and the review
 * evidence rows: checked over the requested interval (the corrected endpoints,
 * or the work's own), now. Empty when the revision requests no vehicle use.
 */
export async function submittedVehicleUseWarnings(
	reader: VehicleUseFactsReader,
	revision: TimeCorrectionSubmittedRevisionRecord,
): Promise<VehicleUseWarning[]> {
	const { baseline, requested, changeMask, intent } = revision.facts;
	if (intent === "delete" || !changeMask.vehicleUse || !requested.vehicleUse?.value) return [];
	const start = changeMask.clockIn && requested.clockIn ? requested.clockIn : baseline.clockIn;
	const end = changeMask.clockOut && requested.clockOut ? requested.clockOut : baseline.clockOut;
	return checkWorkVehicleUsePlausibility(reader, {
		organizationId: revision.organizationId,
		employeeId: revision.subjectEmployeeId,
		use: requested.vehicleUse.value,
		start: parseInstant(start.at),
		end: end ? parseInstant(end.at) : null,
		excludeWorkPeriodId: revision.workPeriodId,
	});
}
