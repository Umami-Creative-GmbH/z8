/**
 * Completing a clock-out's vehicle use (#1125, spec #807; ADR 0009). A client
 * that cannot ask before it clocks out (the Teams bot: the clock command never
 * waits for vehicle use) asks right after, and the answer completes the closed
 * work with what the clock-out could have carried: the end reading or the driven
 * distance, or the vehicle and readings when the work recorded no vehicle.
 *
 * A completion only fills what is missing. It never changes a recorded vehicle
 * or reading, so it is not a correction; corrections go through the change
 * policy. Pure: no I/O.
 */
import type { ClockVehicleUse } from "./clock-vehicle-use";
import {
	buildWorkVehicleUse,
	type VehicleChoice,
	type WorkVehicleUse,
	type WorkVehicleUseRefusalCode,
} from "./work-vehicle-use";

function sameVehicle(left: VehicleChoice, right: VehicleChoice): boolean {
	if (left.kind === "own" || right.kind === "own") return left.kind === right.kind;
	return left.vehicleId === right.vehicleId;
}

/**
 * The vehicle use the closed work records after the completion: the supplied
 * fields where the work records none. Readings named for another vehicle than
 * the recorded one are not this vehicle's and are left out. Without any vehicle
 * nothing is recorded (`use: null`).
 */
export function clockOutCompletionVehicleUse(
	current: WorkVehicleUse | null,
	supplied: ClockVehicleUse,
): { ok: true; use: WorkVehicleUse | null } | { ok: false; code: WorkVehicleUseRefusalCode } {
	if (current && supplied.vehicle && !sameVehicle(current.vehicle, supplied.vehicle)) {
		return { ok: true, use: current };
	}
	// An end reading or a distance already ends the drive.
	if (current && (current.endKm !== null || current.distanceKm !== null)) {
		return { ok: true, use: current };
	}
	const vehicle = current?.vehicle ?? supplied.vehicle;
	if (!vehicle) return { ok: true, use: current };
	const startKm = current?.startKm ?? supplied.startKm ?? null;
	const endKm = current?.endKm ?? supplied.endKm ?? null;
	const built = buildWorkVehicleUse({
		vehicle,
		startKm,
		endKm,
		// A recorded distance stays; one derived from readings is derived again.
		distanceKm: current?.distanceKm ?? supplied.distanceKm ?? null,
	});
	return built.ok ? { ok: true, use: built.use } : built;
}
