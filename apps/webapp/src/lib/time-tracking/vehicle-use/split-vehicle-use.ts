/**
 * Vehicle use when work is split in two (#1126, spec #807; Time Tracking glossary
 * "Vehicle use"): the vehicle carries over to both halves, and one value at the
 * split divides the kilometres, as at a break.
 *
 * - With odometer readings the value is the reading at the split: it ends the
 *   first half's readings and starts the second's. Without it both cut readings
 *   stay missing; a reading is never invented.
 * - With only a directly entered distance the value is the first half's
 *   kilometres; the remainder goes to the second half. Without it the whole
 *   distance stays on the first half, which keeps the work period's id.
 *
 * Automatic writers (break adjustments) have no value and split with none. No
 * I/O and no server-only imports: the split dialog asks with the same rule.
 */
import {
	buildWorkVehicleUse,
	MAX_DRIVEN_DISTANCE_KM,
	MAX_ODOMETER_KM,
	type WorkVehicleUse,
	type WorkVehicleUseRefusalCode,
} from "./work-vehicle-use";

/** What the split asks: the reading at the split, the first half's km, or nothing. */
export type VehicleUseSplitAsk = "reading" | "first_half_distance";

export type WorkVehicleUseSplitRefusalCode =
	| Extract<WorkVehicleUseRefusalCode, "invalid_reading" | "invalid_distance">
	/** The value lies outside the readings or above the driven distance, or nothing is asked. */
	| "split_value_out_of_range";

export type WorkVehicleUseSplit =
	| { ok: true; retained: WorkVehicleUse | null; generated: WorkVehicleUse | null }
	| { ok: false; code: WorkVehicleUseSplitRefusalCode };

export function vehicleUseSplitAsks(use: WorkVehicleUse | null): VehicleUseSplitAsk | null {
	if (!use) return null;
	if (use.startKm !== null || use.endKm !== null) return "reading";
	return use.distanceKm !== null ? "first_half_distance" : null;
}

function wholeKm(value: number, max: number): boolean {
	return Number.isInteger(value) && value >= 0 && value <= max;
}

const OUT_OF_RANGE = { ok: false, code: "split_value_out_of_range" } as const;

/** Both halves, each still valid vehicle use; anything else is out of range. */
function halves(
	vehicle: WorkVehicleUse["vehicle"],
	retained: { startKm: number | null; endKm: number | null; distanceKm: number | null },
	generated: { startKm: number | null; endKm: number | null; distanceKm: number | null },
): WorkVehicleUseSplit {
	const first = buildWorkVehicleUse({ vehicle, ...retained });
	const second = buildWorkVehicleUse({ vehicle, ...generated });
	if (!first.ok || !second.ok) return OUT_OF_RANGE;
	return { ok: true, retained: first.use, generated: second.use };
}

/**
 * The vehicle use of the retained (first) and generated (second) half. `value`
 * is what `vehicleUseSplitAsks` asks for, or null when skipped or not asked.
 */
export function splitWorkVehicleUse(
	use: WorkVehicleUse | null,
	value: number | null | undefined,
): WorkVehicleUseSplit {
	const ask = vehicleUseSplitAsks(use);
	const given = value ?? null;
	if (!use) return given === null ? { ok: true, retained: null, generated: null } : OUT_OF_RANGE;
	if (given !== null && ask === null) return OUT_OF_RANGE;
	const { vehicle, startKm, endKm, distanceKm } = use;

	if (ask === "first_half_distance") {
		const total = distanceKm as number;
		if (given === null) {
			return halves(
				vehicle,
				{ startKm: null, endKm: null, distanceKm: total },
				{ startKm: null, endKm: null, distanceKm: null },
			);
		}
		if (!wholeKm(given, MAX_DRIVEN_DISTANCE_KM)) return { ok: false, code: "invalid_distance" };
		if (given > total) return OUT_OF_RANGE;
		return halves(
			vehicle,
			{ startKm: null, endKm: null, distanceKm: given },
			{ startKm: null, endKm: null, distanceKm: total - given },
		);
	}

	if (ask === "reading") {
		if (given === null) {
			// Without a start reading the entered distance stays on the first half.
			return halves(
				vehicle,
				{ startKm, endKm: null, distanceKm: startKm === null ? distanceKm : null },
				{ startKm: null, endKm, distanceKm: null },
			);
		}
		if (!wholeKm(given, MAX_ODOMETER_KM)) return { ok: false, code: "invalid_reading" };
		if ((startKm !== null && given < startKm) || (endKm !== null && given > endKm)) {
			return OUT_OF_RANGE;
		}
		if (startKm !== null) {
			return halves(
				vehicle,
				{ startKm, endKm: given, distanceKm: null },
				{ startKm: given, endKm, distanceKm: null },
			);
		}
		// Only an end reading: the second half's distance is read off the odometer and
		// the rest of the entered distance stays with the first half.
		const secondKm = (endKm as number) - given;
		const firstKm = distanceKm === null ? null : distanceKm - secondKm;
		if (firstKm !== null && firstKm < 0) return OUT_OF_RANGE;
		return halves(
			vehicle,
			{ startKm: null, endKm: given, distanceKm: firstKm },
			{ startKm: given, endKm, distanceKm: null },
		);
	}

	return halves(
		vehicle,
		{ startKm: null, endKm: null, distanceKm: null },
		{ startKm: null, endKm: null, distanceKm: null },
	);
}
