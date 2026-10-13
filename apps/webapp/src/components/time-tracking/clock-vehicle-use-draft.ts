import type {
	BreakVehicleUse,
	ClockVehicleUse,
} from "@/lib/time-tracking/vehicle-use/clock-vehicle-use";
import {
	buildWorkVehicleUse,
	type WorkVehicleUse,
	type WorkVehicleUseRefusalCode,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import { type VehicleUseDraft, vehicleUseFromDraft } from "./vehicle-use-draft";

/**
 * What the web clock sends as vehicle use (#1122), from what the employee
 * entered. Each result names a refusal the clock shows inline; the clock event
 * itself then still runs, without the vehicle use.
 */
export type ClockVehicleUseDraftResult<Use> =
	| { ok: true; vehicleUse?: Use }
	| { ok: false; code: WorkVehicleUseRefusalCode };

/** Only the readings that were entered: absent ones keep what the work records. */
function entered(use: Pick<WorkVehicleUse, "startKm" | "endKm" | "distanceKm">) {
	return {
		...(use.startKm === null ? {} : { startKm: use.startKm }),
		...(use.endKm === null ? {} : { endKm: use.endKm }),
		...(use.distanceKm === null ? {} : { distanceKm: use.distanceKm }),
	};
}

/** The clock-in's vehicle and start reading; nothing without a vehicle. */
export function clockInVehicleUseFromDraft(
	draft: VehicleUseDraft,
): ClockVehicleUseDraftResult<ClockVehicleUse> {
	const result = vehicleUseFromDraft({ ...draft, endKm: "", distanceKm: "" });
	if (!result.ok) return result;
	if (!result.use) return { ok: true };
	return { ok: true, vehicleUse: { vehicle: result.use.vehicle, ...entered(result.use) } };
}

function parseKm(value: string): number | null | "invalid" {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	return /^\d+$/.test(trimmed) ? Number(trimmed) : "invalid";
}

/**
 * The clock-out's readings. With live vehicle use, the end reading, or the
 * distance while the work has no start reading; without it, the whole vehicle
 * use as entered.
 */
export function clockOutVehicleUseFromDraft(
	draft: VehicleUseDraft,
	live: WorkVehicleUse | null,
): ClockVehicleUseDraftResult<ClockVehicleUse> {
	if (!live) {
		const result = vehicleUseFromDraft(draft);
		if (!result.ok) return result;
		if (!result.use) return { ok: true };
		return { ok: true, vehicleUse: { vehicle: result.use.vehicle, ...entered(result.use) } };
	}
	const endKm = parseKm(draft.endKm);
	const distanceKm = live.startKm === null ? parseKm(draft.distanceKm) : null;
	if (endKm === "invalid") return { ok: false, code: "invalid_reading" };
	if (distanceKm === "invalid") return { ok: false, code: "invalid_distance" };
	if (endKm === null && distanceKm === null) return { ok: true };
	const built = buildWorkVehicleUse({
		vehicle: live.vehicle,
		startKm: live.startKm,
		endKm,
		distanceKm: distanceKm ?? live.distanceKm,
	});
	if (!built.ok) return built;
	return {
		ok: true,
		vehicleUse: {
			...(endKm === null ? {} : { endKm }),
			...(distanceKm === null ? {} : { distanceKm }),
		},
	};
}

/** A break's one reading, which must not be below the live start reading. */
export function breakVehicleUseFromReading(
	reading: string,
	live: WorkVehicleUse | null,
): ClockVehicleUseDraftResult<BreakVehicleUse> {
	if (!live) return { ok: true };
	const readingKm = parseKm(reading);
	if (readingKm === "invalid") return { ok: false, code: "invalid_reading" };
	if (readingKm === null) return { ok: true };
	const built = buildWorkVehicleUse({
		vehicle: live.vehicle,
		startKm: live.startKm,
		endKm: readingKm,
		distanceKm: live.distanceKm,
	});
	return built.ok ? { ok: true, vehicleUse: { readingKm } } : built;
}
