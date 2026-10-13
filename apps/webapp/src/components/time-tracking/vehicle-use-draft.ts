import {
	buildWorkVehicleUse,
	type WorkVehicleUse,
	type WorkVehicleUseInput,
	type WorkVehicleUseRefusalCode,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";

/**
 * Vehicle use as a form edits it (#1120): text inputs and one vehicle choice.
 * `vehicle` is "" for none, "own" for the employee's own vehicle, or an
 * organization vehicle id.
 */
export type VehicleUseDraft = {
	vehicle: string;
	startKm: string;
	endKm: string;
	distanceKm: string;
};

export const EMPTY_VEHICLE_USE_DRAFT: VehicleUseDraft = {
	vehicle: "",
	startKm: "",
	endKm: "",
	distanceKm: "",
};

const km = (value: number | null) => (value === null ? "" : String(value));

export function vehicleUseDraftOf(use: WorkVehicleUse | null | undefined): VehicleUseDraft {
	if (!use) return EMPTY_VEHICLE_USE_DRAFT;
	return {
		vehicle: use.vehicle.kind === "organization" ? use.vehicle.vehicleId : "own",
		startKm: km(use.startKm),
		endKm: km(use.endKm),
		// A derived distance is shown, not entered.
		distanceKm: use.startKm === null ? km(use.distanceKm) : "",
	};
}

function parseKm(value: string): number | null | "invalid" {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	if (!/^\d+$/.test(trimmed)) return "invalid";
	return Number(trimmed);
}

export type VehicleUseDraftResult =
	| { ok: true; input: WorkVehicleUseInput | null; use: WorkVehicleUse | null }
	| { ok: false; code: WorkVehicleUseRefusalCode };

/**
 * The draft as submittable input, validated with the server's rules: no vehicle
 * is no vehicle use (readings without a vehicle are refused), and an end reading
 * below the start reading is refused.
 */
export function vehicleUseFromDraft(draft: VehicleUseDraft): VehicleUseDraftResult {
	const startKm = parseKm(draft.startKm);
	const endKm = parseKm(draft.endKm);
	const distanceKm = parseKm(draft.distanceKm);
	if (startKm === "invalid" || endKm === "invalid") return { ok: false, code: "invalid_reading" };
	if (distanceKm === "invalid") return { ok: false, code: "invalid_distance" };
	if (!draft.vehicle) {
		return startKm === null && endKm === null && distanceKm === null
			? { ok: true, input: null, use: null }
			: { ok: false, code: "invalid_vehicle" };
	}
	const input: WorkVehicleUseInput = {
		vehicle:
			draft.vehicle === "own" ? { kind: "own" } : { kind: "organization", vehicleId: draft.vehicle },
		startKm,
		endKm,
		// Only while the start reading is missing is the distance entered directly.
		distanceKm: startKm === null ? distanceKm : null,
	};
	const built = buildWorkVehicleUse(input);
	return built.ok ? { ok: true, input, use: built.use } : built;
}
