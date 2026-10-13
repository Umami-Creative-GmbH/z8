import type {
	BreakVehicleUse,
	ClockVehicleUse,
	DesktopVehicleUse,
	VehicleChoice,
	WorkVehicleUse,
} from "../types";

/**
 * Vehicle use at the desktop clock (#1124, spec #807), with the server's rules
 * (`lib/time-tracking/vehicle-use/work-vehicle-use.ts` in the webapp): whole
 * kilometres, at most one vehicle, an end reading never below the start reading,
 * and the distance entered directly only without a start reading. What fails
 * these rules is left out of the clock event, which still runs.
 */

/** The largest odometer reading the server records, in kilometres. */
const MAX_ODOMETER_KM = 9_999_999;
/** The largest driven distance in one work period, in kilometres. */
const MAX_DRIVEN_DISTANCE_KM = 99_999;

/** `vehicle` is "" for none, "own", or an organization vehicle id. */
export interface VehicleUseDraft {
	vehicle: string;
	startKm: string;
	endKm: string;
	distanceKm: string;
}

export const EMPTY_DRAFT: VehicleUseDraft = {
	vehicle: "",
	startKm: "",
	endKm: "",
	distanceKm: "",
};

export type VehicleUseRefusal =
	| "invalid_vehicle"
	| "invalid_reading"
	| "invalid_distance"
	| "end_before_start";

export type VehicleUseResult<Use> =
	| { ok: true; vehicleUse?: Use }
	| { ok: false; code: VehicleUseRefusal };

/** What a resumed manual break starts with: the vehicle and the break's reading. */
export interface CarriedVehicle {
	vehicle: string;
	startKm: string;
}

const km = (value: number | null | undefined) =>
	value === null || value === undefined ? "" : String(value);

export function draftVehicleOf(vehicle: VehicleChoice): string {
	return vehicle.kind === "own" ? "own" : vehicle.vehicleId;
}

/**
 * The draft new work starts with: a resumed manual break's vehicle and reading,
 * or else the first assigned vehicle with its last recorded end reading.
 */
export function prefilledDraft(
	context: DesktopVehicleUse | undefined,
	carried?: CarriedVehicle | null,
): VehicleUseDraft {
	if (!context || context.mode === "off") return EMPTY_DRAFT;
	if (carried) return { ...EMPTY_DRAFT, ...carried };
	const vehicleId = context.suggestedVehicleIds[0];
	if (!vehicleId) return EMPTY_DRAFT;
	return {
		...EMPTY_DRAFT,
		vehicle: vehicleId,
		startKm: km(context.lastEndKmByVehicleId[vehicleId]),
	};
}

/**
 * Picking a vehicle re-fills a start reading that is empty or still the
 * previous vehicle's pre-fill; a reading the employee typed is kept.
 */
export function withPickedVehicle(
	draft: VehicleUseDraft,
	vehicle: string,
	lastEndKmByVehicleId: Record<string, number>,
): VehicleUseDraft {
	const untouched =
		draft.startKm.trim() === "" ||
		draft.startKm === km(lastEndKmByVehicleId[draft.vehicle]);
	if (!untouched) return { ...draft, vehicle };
	return {
		...draft,
		vehicle,
		startKm: vehicle === "own" ? "" : km(lastEndKmByVehicleId[vehicle]),
	};
}

function parseKm(value: string, max: number): number | null | "invalid" {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	if (!/^\d+$/.test(trimmed)) return "invalid";
	const parsed = Number(trimmed);
	return parsed > max ? "invalid" : parsed;
}

function choiceOf(vehicle: string): VehicleChoice {
	return vehicle === "own"
		? { kind: "own" }
		: { kind: "organization", vehicleId: vehicle };
}

/** Validates vehicle use as it would be recorded; `null` readings are missing. */
function check(use: WorkVehicleUse): VehicleUseRefusal | null {
	if (use.startKm !== null && use.endKm !== null) {
		if (use.endKm < use.startKm) return "end_before_start";
		if (use.endKm - use.startKm > MAX_DRIVEN_DISTANCE_KM)
			return "invalid_distance";
	}
	return null;
}

/** Only the readings that were entered. */
function entered(readings: {
	startKm: number | null;
	endKm: number | null;
	distanceKm: number | null;
}): Omit<ClockVehicleUse, "vehicle"> {
	return {
		...(readings.startKm === null ? {} : { startKm: readings.startKm }),
		...(readings.endKm === null ? {} : { endKm: readings.endKm }),
		...(readings.distanceKm === null
			? {}
			: { distanceKm: readings.distanceKm }),
	};
}

/** The whole vehicle use as entered; nothing without a vehicle. */
function wholeVehicleUse(
	draft: VehicleUseDraft,
): VehicleUseResult<ClockVehicleUse> {
	const startKm = parseKm(draft.startKm, MAX_ODOMETER_KM);
	const endKm = parseKm(draft.endKm, MAX_ODOMETER_KM);
	const distance = parseKm(draft.distanceKm, MAX_DRIVEN_DISTANCE_KM);
	if (startKm === "invalid" || endKm === "invalid")
		return { ok: false, code: "invalid_reading" };
	if (distance === "invalid") return { ok: false, code: "invalid_distance" };
	if (!draft.vehicle) {
		return startKm === null && endKm === null && distance === null
			? { ok: true }
			: { ok: false, code: "invalid_vehicle" };
	}
	const vehicle = choiceOf(draft.vehicle);
	const distanceKm = startKm === null ? distance : null;
	const refusal = check({ vehicle, startKm, endKm, distanceKm });
	if (refusal) return { ok: false, code: refusal };
	return {
		ok: true,
		vehicleUse: { vehicle, ...entered({ startKm, endKm, distanceKm }) },
	};
}

/** A clock-in's vehicle and start reading. */
export function clockInVehicleUse(
	draft: VehicleUseDraft,
): VehicleUseResult<ClockVehicleUse> {
	return wholeVehicleUse({ ...draft, endKm: "", distanceKm: "" });
}

/**
 * A clock-out's readings. Over live vehicle use, the end reading, or the
 * distance while the work has no start reading; without it, the whole vehicle
 * use as entered.
 */
export function clockOutVehicleUse(
	draft: VehicleUseDraft,
	live: WorkVehicleUse | null,
): VehicleUseResult<ClockVehicleUse> {
	if (!live) return wholeVehicleUse(draft);
	const endKm = parseKm(draft.endKm, MAX_ODOMETER_KM);
	const distanceKm =
		live.startKm === null
			? parseKm(draft.distanceKm, MAX_DRIVEN_DISTANCE_KM)
			: null;
	if (endKm === "invalid") return { ok: false, code: "invalid_reading" };
	if (distanceKm === "invalid") return { ok: false, code: "invalid_distance" };
	if (endKm === null && distanceKm === null) return { ok: true };
	const refusal = check({ ...live, endKm });
	if (refusal) return { ok: false, code: refusal };
	return {
		ok: true,
		vehicleUse: entered({ startKm: null, endKm, distanceKm }),
	};
}

/** A break's one reading, while the live work records a vehicle. */
export function breakVehicleUse(
	reading: string,
	live: WorkVehicleUse | null,
): VehicleUseResult<BreakVehicleUse> {
	if (!live) return { ok: true };
	const readingKm = parseKm(reading, MAX_ODOMETER_KM);
	if (readingKm === "invalid") return { ok: false, code: "invalid_reading" };
	if (readingKm === null) return { ok: true };
	const refusal = check({ ...live, endKm: readingKm });
	return refusal
		? { ok: false, code: refusal }
		: { ok: true, vehicleUse: { readingKm } };
}

/**
 * The vehicle use the work would record after the clock event, for its
 * plausibility warnings; null when there is nothing to check.
 */
export function vehicleUseForWarnings(
	sent: ClockVehicleUse | undefined,
	live: WorkVehicleUse | null,
): WorkVehicleUse | null {
	const vehicle = sent?.vehicle ?? live?.vehicle;
	if (!sent || !vehicle) return null;
	return {
		vehicle,
		startKm: sent.startKm ?? live?.startKm ?? null,
		endKm: sent.endKm ?? live?.endKm ?? null,
		distanceKm: sent.distanceKm ?? live?.distanceKm ?? null,
	};
}
