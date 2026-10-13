import {
	PLAUSIBLE_AVERAGE_SPEED_KMH,
	PLAUSIBLE_DISTANCE_KM,
	type VehicleUseWarning,
} from "@/lib/time-tracking/vehicle-use/plausibility";
import type { WorkVehicleUseChangeRefusalCode } from "@/lib/time-tracking/vehicle-use/work-vehicle-use-refusals";

/**
 * Vehicle use as text (#1120): the work period, the edit dialogs and the
 * approval card share one wording. `t` is the caller's Tolgee translate function.
 */
type Translate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

/** What to show for one recorded vehicle use. */
export type VehicleUseDisplay =
	| { state: "none" }
	| {
			state: "recorded";
			vehicle: { kind: "own" } | { kind: "organization"; label: string | null };
			startKm: number | null;
			endKm: number | null;
			distanceKm: number | null;
	  };

export function vehicleUseVehicleText(t: Translate, display: VehicleUseDisplay): string {
	if (display.state === "none") return t("timeTracking.vehicleUse.noVehicle", "No vehicle");
	if (display.vehicle.kind === "own") {
		return t("timeTracking.vehicleUse.ownVehicle", "Own vehicle");
	}
	return (
		display.vehicle.label ??
		t("timeTracking.vehicleUse.unknownVehicle", "Unknown vehicle (unavailable)")
	);
}

/** The readings and the driven distance, e.g. "12,000 → 12,085 km · 85 km driven". */
export function vehicleUseKilometresText(t: Translate, display: VehicleUseDisplay): string {
	if (display.state === "none") return "";
	const parts: string[] = [];
	if (display.startKm !== null || display.endKm !== null) {
		parts.push(
			t("timeTracking.vehicleUse.readingsText", "{start} → {end} km", {
				start:
					display.startKm === null
						? t("timeTracking.vehicleUse.readingMissing", "–")
						: display.startKm.toLocaleString(),
				end:
					display.endKm === null
						? t("timeTracking.vehicleUse.readingMissing", "–")
						: display.endKm.toLocaleString(),
			}),
		);
	}
	if (display.distanceKm !== null) {
		parts.push(
			t("timeTracking.vehicleUse.distanceText", "{distance} km driven", {
				distance: display.distanceKm.toLocaleString(),
			}),
		);
	}
	return parts.join(" · ");
}

export function vehicleUseText(t: Translate, display: VehicleUseDisplay): string {
	const kilometres = vehicleUseKilometresText(t, display);
	const vehicle = vehicleUseVehicleText(t, display);
	return kilometres ? `${vehicle} · ${kilometres}` : vehicle;
}

/** The translated message of a plausibility warning (#1121); it never blocks saving. */
export function vehicleUseWarningText(t: Translate, warning: VehicleUseWarning): string {
	switch (warning.code) {
		case "start_below_last_end":
			return t(
				"timeTracking.vehicleUse.warning.startBelowLastEnd",
				"The start reading is below this vehicle's last recorded end reading ({lastEndKm} km).",
				{ lastEndKm: warning.lastRecordedEndKm.toLocaleString() },
			);
		case "vehicle_on_other_live_work":
			return t(
				"timeTracking.vehicleUse.warning.onOtherLiveWork",
				"This vehicle is already recorded on another employee's running work.",
			);
		case "speed_above_limit":
			return t(
				"timeTracking.vehicleUse.warning.speedAboveLimit",
				"The driven distance implies an average of {speed} km/h over this work period, more than {limit} km/h.",
				{
					speed: warning.averageKmh.toLocaleString(),
					limit: PLAUSIBLE_AVERAGE_SPEED_KMH.toLocaleString(),
				},
			);
		case "distance_above_limit":
			return t(
				"timeTracking.vehicleUse.warning.distanceAboveLimit",
				"{distance} km is more than {limit} km in one work period.",
				{
					distance: warning.distanceKm.toLocaleString(),
					limit: PLAUSIBLE_DISTANCE_KM.toLocaleString(),
				},
			);
	}
}

/** The translated message of a refused vehicle use change. */
export function vehicleUseRefusalText(t: Translate, code: WorkVehicleUseChangeRefusalCode): string {
	switch (code) {
		case "end_before_start":
			return t(
				"timeTracking.vehicleUse.refusal.endBeforeStart",
				"The end reading cannot be below the start reading.",
			);
		case "invalid_reading":
			return t(
				"timeTracking.vehicleUse.refusal.invalidReading",
				"Enter odometer readings in whole kilometres.",
			);
		case "invalid_distance":
			return t(
				"timeTracking.vehicleUse.refusal.invalidDistance",
				"Enter the driven distance in whole kilometres.",
			);
		case "invalid_vehicle":
			return t(
				"timeTracking.vehicleUse.refusal.invalidVehicle",
				"Choose an organization vehicle or your own vehicle.",
			);
		case "vehicle_use_off":
			return t(
				"timeTracking.vehicleUse.refusal.off",
				"Vehicle use is not recorded for this employee.",
			);
		case "vehicle_not_found":
			return t("timeTracking.vehicleUse.refusal.notFound", "The vehicle was not found.");
		case "vehicle_archived":
			return t(
				"timeTracking.vehicleUse.refusal.archived",
				"This vehicle is archived and can no longer be picked.",
			);
	}
}
