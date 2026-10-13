import "server-only";

import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	checkWorkVehicleUsePlausibility,
	type VehicleUseFactsReader,
} from "@/lib/time-tracking/vehicle-use/plausibility-check";
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
