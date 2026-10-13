/**
 * Vehicle use on a work period (#1120, spec #807; Time Tracking glossary
 * "Driving", ADR 0009): which vehicle the employee drove during the work, its
 * odometer readings and the driven distance, in whole kilometres. It is part of
 * the work's attribution and is stored on the work period and on its canonical
 * work record (`time_record_work`) in the same five columns.
 *
 * This file has no I/O and no server-only imports, so the server, the edit
 * dialogs and the approval card share one set of rules:
 * - at most one vehicle: an organization vehicle (by id) or the employee's own
 *   vehicle, which identifies no vehicle;
 * - the driven distance is the end reading minus the start reading; only while
 *   the start reading is missing may the distance be entered directly;
 * - an end reading below the start reading is refused.
 *
 * Plausibility warnings (#1121) never refuse and live elsewhere.
 */

/** The largest odometer reading accepted, in kilometres (seven digits). */
export const MAX_ODOMETER_KM = 9_999_999;
/** The largest driven distance accepted in one work period, in kilometres. */
export const MAX_DRIVEN_DISTANCE_KM = 99_999;

export type VehicleChoice = { kind: "own" } | { kind: "organization"; vehicleId: string };

/** Recorded vehicle use. `distanceKm` is derived whenever both readings exist. */
export type WorkVehicleUse = {
	vehicle: VehicleChoice;
	startKm: number | null;
	endKm: number | null;
	distanceKm: number | null;
};

/** An organization vehicle as a picker or a display shows it. */
export type WorkVehicleOption = {
	id: string;
	name: string;
	licencePlate: string;
	/** Archived vehicles stay on recorded work but cannot be newly picked. */
	archived: boolean;
};

/**
 * What a form needs to show or edit vehicle use on one employee's work. With
 * mode `off`, recorded vehicle use is shown read-only and nothing is asked.
 */
export type WorkVehicleUseFormContext = {
	mode: "off" | "asked" | "expected";
	/** Active vehicles, plus the archived ones named in recorded vehicle use. */
	vehicles: WorkVehicleOption[];
};

/** What a writer asks for: absent or `preserve` keeps it, `clear` removes it. */
export type VehicleUseIntent =
	| { kind: "preserve" }
	| { kind: "clear" }
	| { kind: "set"; use: WorkVehicleUse };

/** Why entered vehicle use is invalid. Each code has a translated message in the UI. */
export type WorkVehicleUseRefusalCode =
	| "end_before_start"
	| "invalid_reading"
	| "invalid_distance"
	| "invalid_vehicle";

/** Entered vehicle use before derivation: absent values are missing readings. */
export type WorkVehicleUseEntry = {
	vehicle: unknown;
	startKm?: unknown;
	endKm?: unknown;
	distanceKm?: unknown;
};

/** Vehicle use as a form submits it; the server validates it and derives the distance. */
export interface WorkVehicleUseInput {
	vehicle: VehicleChoice;
	startKm?: number | null;
	endKm?: number | null;
	distanceKm?: number | null;
}

/** The stored columns, identical on `work_period` and `time_record_work`. */
export type WorkVehicleUseColumns = {
	vehicleKind: "organization" | "own" | null;
	vehicleId: string | null;
	odometerStartKm: number | null;
	odometerEndKm: number | null;
	drivenDistanceKm: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wholeKm(value: unknown, max: number): number | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
		return undefined;
	}
	return value;
}

function vehicleChoiceOf(value: unknown): VehicleChoice | null {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value as { kind?: unknown; vehicleId?: unknown };
	if (candidate.kind === "own") return { kind: "own" };
	if (
		candidate.kind === "organization" &&
		typeof candidate.vehicleId === "string" &&
		UUID.test(candidate.vehicleId)
	) {
		return { kind: "organization", vehicleId: candidate.vehicleId.toLowerCase() };
	}
	return null;
}

/** Validates entered vehicle use and derives its driven distance. */
export function buildWorkVehicleUse(
	entry: WorkVehicleUseEntry,
): { ok: true; use: WorkVehicleUse } | { ok: false; code: WorkVehicleUseRefusalCode } {
	const vehicle = vehicleChoiceOf(entry.vehicle);
	if (!vehicle) return { ok: false, code: "invalid_vehicle" };
	const startKm = wholeKm(entry.startKm, MAX_ODOMETER_KM);
	const endKm = wholeKm(entry.endKm, MAX_ODOMETER_KM);
	if (startKm === undefined || endKm === undefined) return { ok: false, code: "invalid_reading" };
	const entered = wholeKm(entry.distanceKm, MAX_DRIVEN_DISTANCE_KM);
	if (entered === undefined) return { ok: false, code: "invalid_distance" };
	if (startKm !== null && endKm !== null) {
		if (endKm < startKm) return { ok: false, code: "end_before_start" };
		if (endKm - startKm > MAX_DRIVEN_DISTANCE_KM) return { ok: false, code: "invalid_distance" };
		return { ok: true, use: { vehicle, startKm, endKm, distanceKm: endKm - startKm } };
	}
	// With a start reading the distance comes from the end reading alone.
	const distanceKm = startKm === null ? entered : null;
	return { ok: true, use: { vehicle, startKm, endKm, distanceKm } };
}

export function vehicleUseColumns(use: WorkVehicleUse | null): WorkVehicleUseColumns {
	if (!use) {
		return {
			vehicleKind: null,
			vehicleId: null,
			odometerStartKm: null,
			odometerEndKm: null,
			drivenDistanceKm: null,
		};
	}
	return {
		vehicleKind: use.vehicle.kind,
		vehicleId: use.vehicle.kind === "organization" ? use.vehicle.vehicleId : null,
		odometerStartKm: use.startKm,
		odometerEndKm: use.endKm,
		drivenDistanceKm: use.distanceKm,
	};
}

/** The vehicle use a stored row records, or null without a vehicle. */
export function vehicleUseFromColumns(row: Partial<WorkVehicleUseColumns>): WorkVehicleUse | null {
	if (!row.vehicleKind) return null;
	return {
		vehicle:
			row.vehicleKind === "organization" && row.vehicleId
				? { kind: "organization", vehicleId: row.vehicleId }
				: { kind: "own" },
		startKm: row.odometerStartKm ?? null,
		endKm: row.odometerEndKm ?? null,
		distanceKm: row.drivenDistanceKm ?? null,
	};
}

/** A stable text identity: equal for equal vehicle use. Also used in submission keys. */
export function vehicleUseIdentity(use: WorkVehicleUse | null): string {
	if (!use) return "none";
	const vehicle = use.vehicle.kind === "organization" ? use.vehicle.vehicleId : "own";
	const km = (value: number | null) => (value === null ? "" : String(value));
	return `${vehicle}:${km(use.startKm)}:${km(use.endKm)}:${km(use.distanceKm)}`;
}

export function sameWorkVehicleUse(
	left: WorkVehicleUse | null | undefined,
	right: WorkVehicleUse | null | undefined,
): boolean {
	return vehicleUseIdentity(left ?? null) === vehicleUseIdentity(right ?? null);
}

/** The organization vehicle id of vehicle use, or null for own vehicle or none. */
export function organizationVehicleIdOf(use: WorkVehicleUse | null | undefined): string | null {
	return use?.vehicle.kind === "organization" ? use.vehicle.vehicleId : null;
}

/** The vehicle use after an intent; `preserve` (or none) keeps the current one. */
export function vehicleUseAfter(
	intent: VehicleUseIntent | undefined,
	current: WorkVehicleUse | null,
): WorkVehicleUse | null {
	if (!intent || intent.kind === "preserve") return current;
	return intent.kind === "clear" ? null : intent.use;
}

/**
 * The intent for submitted vehicle use, as a spreadable fragment: nothing when
 * not submitted (earlier intents stay byte-identical), `clear` for null.
 */
export function workVehicleUseIntentOf(submitted: WorkVehicleUse | null | undefined): {
	vehicleUse?: VehicleUseIntent;
} {
	if (submitted === undefined) return {};
	return { vehicleUse: submitted === null ? { kind: "clear" } : { kind: "set", use: submitted } };
}

/** Submitted vehicle use as a request-evidence string (`AmendCompletedWorkCommand.request`). */
export function workVehicleUseRequestValue(use: WorkVehicleUse | null): string | null {
	return use === null ? null : JSON.stringify(use);
}

function exactKeys(value: object, keys: readonly string[]): boolean {
	const own = Object.keys(value);
	return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Reads stored or transported vehicle use (receipts, approval contracts) strictly:
 * exactly the recorded shape, already derived. Throws on anything else.
 */
export function readWorkVehicleUse(value: unknown): WorkVehicleUse | null {
	if (value === null) return null;
	if (
		typeof value !== "object" ||
		Array.isArray(value) ||
		!exactKeys(value, ["vehicle", "startKm", "endKm", "distanceKm"])
	) {
		throw new Error("Invalid vehicle use");
	}
	const candidate = value as Record<string, unknown>;
	const vehicle = candidate.vehicle;
	if (
		typeof vehicle !== "object" ||
		vehicle === null ||
		!exactKeys(
			vehicle,
			(vehicle as { kind?: unknown }).kind === "own" ? ["kind"] : ["kind", "vehicleId"],
		)
	) {
		throw new Error("Invalid vehicle use");
	}
	const built = buildWorkVehicleUse(candidate as WorkVehicleUseEntry);
	if (
		!built.ok ||
		vehicleUseIdentity(built.use) !==
			vehicleUseIdentity({
				vehicle: built.use.vehicle,
				startKm: candidate.startKm as number | null,
				endKm: candidate.endKm as number | null,
				distanceKm: candidate.distanceKm as number | null,
			}) ||
		(built.use.vehicle.kind === "organization" &&
			built.use.vehicle.vehicleId !== (vehicle as { vehicleId?: unknown }).vehicleId)
	) {
		throw new Error("Invalid vehicle use");
	}
	return built.use;
}
