/**
 * Plausibility warnings for entered vehicle use (#1121, spec #807; Time Tracking
 * glossary "Driving"). They never refuse or delay anything: the entry is saved
 * as entered, and the employee (on entry) and the approver of a correction see
 * why it looks unusual.
 *
 * This file has no I/O and no server-only imports. The facts that need the
 * database (the vehicle's last recorded end reading, other employees' live
 * work) are read by `plausibility-check.ts`.
 */

import type { Instant } from "@/lib/datetime/temporal-core";
import type { WorkVehicleUse } from "./work-vehicle-use";

/** Above this average speed over a work period (km/h) the distance looks implausible. */
export const PLAUSIBLE_AVERAGE_SPEED_KMH = 150;
/** Above this driven distance in one work period (km) the distance looks implausible. */
export const PLAUSIBLE_DISTANCE_KM = 1_500;

export type VehicleUseWarning =
	/** The start reading is below the vehicle's last recorded end reading. */
	| { code: "start_below_last_end"; lastRecordedEndKm: number }
	/** The vehicle is already on another employee's live work. */
	| { code: "vehicle_on_other_live_work" }
	/** The implied average speed over the work period, rounded up to 0.1 km/h. */
	| { code: "speed_above_limit"; averageKmh: number }
	| { code: "distance_above_limit"; distanceKm: number };

export type VehicleUseWarningCode = VehicleUseWarning["code"];

export interface VehicleUsePlausibilityFacts {
	use: WorkVehicleUse;
	/** The work period's start and end; `end` is null while the work is live. */
	start: Instant;
	end: Instant | null;
	/** The vehicle's last recorded end reading before this work, for an organization vehicle. */
	lastRecordedEndKm: number | null;
	/** Whether another employee's live work already records this organization vehicle. */
	vehicleOnOtherLiveWork: boolean;
}

const MILLISECONDS_PER_HOUR = 3_600_000;

/** The warnings for entered vehicle use, in a fixed order; empty when it looks plausible. */
export function vehicleUsePlausibilityWarnings(
	facts: VehicleUsePlausibilityFacts,
): VehicleUseWarning[] {
	const { use } = facts;
	const warnings: VehicleUseWarning[] = [];
	const organizationVehicle = use.vehicle.kind === "organization";

	if (
		organizationVehicle &&
		use.startKm !== null &&
		facts.lastRecordedEndKm !== null &&
		use.startKm < facts.lastRecordedEndKm
	) {
		warnings.push({ code: "start_below_last_end", lastRecordedEndKm: facts.lastRecordedEndKm });
	}

	if (organizationVehicle && facts.vehicleOnOtherLiveWork) {
		warnings.push({ code: "vehicle_on_other_live_work" });
	}

	const distanceKm = use.distanceKm;
	if (distanceKm !== null && facts.end !== null) {
		const elapsedMs = facts.end.epochMilliseconds - facts.start.epochMilliseconds;
		// Integer comparison: distance / hours > limit, without rounding.
		if (
			elapsedMs > 0 &&
			distanceKm * MILLISECONDS_PER_HOUR > PLAUSIBLE_AVERAGE_SPEED_KMH * elapsedMs
		) {
			const averageKmh = (distanceKm * MILLISECONDS_PER_HOUR) / elapsedMs;
			warnings.push({ code: "speed_above_limit", averageKmh: Math.ceil(averageKmh * 10) / 10 });
		}
	}

	if (distanceKm !== null && distanceKm > PLAUSIBLE_DISTANCE_KM) {
		warnings.push({ code: "distance_above_limit", distanceKm });
	}

	return warnings;
}
