import type { WorkVehicleUseRefusalCode } from "./work-vehicle-use";

/**
 * Why a change of vehicle use on work is refused (#1120). Shared by the server,
 * which puts the code on `ValidationError.refusal` (field `vehicleUse`) and on
 * action results' `code`, and the client, which translates it. No server-only
 * imports.
 */
export type WorkVehicleUseChangeRefusalCode =
	| WorkVehicleUseRefusalCode
	/** The organization switch is off, or the employee is not asked: vehicle use is read-only. */
	| "vehicle_use_off"
	| "vehicle_not_found"
	/** An archived vehicle stays on recorded work but cannot be newly picked. */
	| "vehicle_archived";

const CODES: readonly WorkVehicleUseChangeRefusalCode[] = [
	"end_before_start",
	"invalid_reading",
	"invalid_distance",
	"invalid_vehicle",
	"vehicle_use_off",
	"vehicle_not_found",
	"vehicle_archived",
];

export function isWorkVehicleUseRefusalCode(
	value: unknown,
): value is WorkVehicleUseChangeRefusalCode {
	return typeof value === "string" && (CODES as readonly string[]).includes(value);
}

/** The vehicle use refusal of a failed action result (`code`, or `refusal`), if any. */
export function workVehicleUseRefusalOfResult(result: {
	code?: string;
	refusal?: string;
}): WorkVehicleUseChangeRefusalCode | null {
	if (isWorkVehicleUseRefusalCode(result.code)) return result.code;
	if (isWorkVehicleUseRefusalCode(result.refusal)) return result.refusal;
	return null;
}
