/**
 * Organization vehicles (#1118, spec #807): reading an org admin's untrusted
 * change, and the licence plate rules. Client-safe; the store is `vehicles.ts`.
 * See the Organization glossary, section "Vehicles".
 */

import { isUuid } from "@/lib/billable-time/input";

export const VEHICLE_NAME_MAX_LENGTH = 100;
export const LICENCE_PLATE_MAX_LENGTH = 20;
/** Employees plus teams one vehicle may have as assigned drivers. */
export const MAX_ASSIGNED_DRIVERS = 500;

/** Employees and teams for whom a vehicle is the one usually driven. Ids of the same organization. */
export interface VehicleDrivers {
	employeeIds: string[];
	teamIds: string[];
}

export type VehicleChange =
	| { kind: "create"; name: string; licencePlate: string; drivers: VehicleDrivers }
	| {
			kind: "update";
			vehicleId: string;
			name: string;
			licencePlate: string;
			drivers: VehicleDrivers;
	  }
	| { kind: "archive"; vehicleId: string }
	| { kind: "restore"; vehicleId: string }
	| { kind: "delete"; vehicleId: string };

/** A change as a client sends it: drivers may be left out (none). Read with `parseVehicleChange`. */
export type VehicleChangeInput =
	| (Omit<Extract<VehicleChange, { kind: "create" }>, "drivers"> & { drivers?: VehicleDrivers })
	| (Omit<Extract<VehicleChange, { kind: "update" }>, "drivers"> & { drivers?: VehicleDrivers })
	| Extract<VehicleChange, { kind: "archive" | "restore" | "delete" }>;

export type VehicleRefusal =
	| "invalid_change"
	| "invalid_name"
	| "invalid_licence_plate"
	| "invalid_drivers"
	| "vehicle_not_found"
	| "vehicle_archived"
	| "licence_plate_taken"
	| "driver_not_found"
	/** A newly assigned driver is a former employee (#1438). */
	| "former_driver"
	/** The vehicle was recorded on work, or an open time correction requests it: it can only be archived. */
	| "vehicle_used";

/**
 * The foreign keys of work that records an organization vehicle, on the period
 * and its canonical record (0224): they refuse deleting a recorded vehicle (the
 * demo reset archives such a vehicle instead).
 */
export const RECORDED_VEHICLE_FOREIGN_KEYS = [
	"workPeriod_vehicle_fk",
	"timeRecordWork_vehicle_fk",
] as const;

/** A plate as stored and shown: trimmed, upper-cased, with single spaces. */
export function normalizeLicencePlate(raw: string): string {
	return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * What makes two plates the same plate: upper-cased, without spaces, hyphens
 * and dots ("M-AB 1234" = "m ab-1234"). Plates are unique per organization by
 * this key; the database computes the same key (`licence_plate_key`).
 */
export function licencePlateKey(plate: string): string {
	return plate.toUpperCase().replace(/[\s.-]/g, "");
}

type Parsed = { ok: true; change: VehicleChange } | { ok: false; reason: VehicleRefusal };

class Refusal {
	constructor(readonly reason: VehicleRefusal) {}
}

function refuse(reason: VehicleRefusal): never {
	throw new Refusal(reason);
}

function vehicleIdOf(value: unknown): string {
	return isUuid(value) ? value.toLowerCase() : refuse("vehicle_not_found");
}

function nameOf(value: unknown): string {
	if (typeof value !== "string") refuse("invalid_name");
	const name = value.trim();
	if (name.length === 0 || name.length > VEHICLE_NAME_MAX_LENGTH) refuse("invalid_name");
	return name;
}

function licencePlateOf(value: unknown): string {
	if (typeof value !== "string") refuse("invalid_licence_plate");
	const plate = normalizeLicencePlate(value);
	if (plate.length > LICENCE_PLATE_MAX_LENGTH || licencePlateKey(plate).length === 0) {
		refuse("invalid_licence_plate");
	}
	return plate;
}

function idsOf(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every(isUuid)) refuse("invalid_drivers");
	return [...new Set(value.map((id) => id.toLowerCase()))];
}

function driversOf(value: unknown): VehicleDrivers {
	if (value === undefined) return { employeeIds: [], teamIds: [] };
	if (!value || typeof value !== "object") refuse("invalid_drivers");
	const record = value as Record<string, unknown>;
	const drivers = { employeeIds: idsOf(record.employeeIds), teamIds: idsOf(record.teamIds) };
	if (drivers.employeeIds.length + drivers.teamIds.length > MAX_ASSIGNED_DRIVERS) {
		refuse("invalid_drivers");
	}
	return drivers;
}

function parse(input: unknown): VehicleChange {
	if (!input || typeof input !== "object") refuse("invalid_change");
	const record = input as Record<string, unknown>;
	switch (record.kind) {
		case "create":
			return {
				kind: "create",
				name: nameOf(record.name),
				licencePlate: licencePlateOf(record.licencePlate),
				drivers: driversOf(record.drivers),
			};
		case "update":
			return {
				kind: "update",
				vehicleId: vehicleIdOf(record.vehicleId),
				name: nameOf(record.name),
				licencePlate: licencePlateOf(record.licencePlate),
				drivers: driversOf(record.drivers),
			};
		case "archive":
		case "restore":
		case "delete":
			return { kind: record.kind, vehicleId: vehicleIdOf(record.vehicleId) };
		default:
			return refuse("invalid_change");
	}
}

/** Reads an org admin's untrusted vehicle change, or names why it is refused. */
export function parseVehicleChange(input: unknown): Parsed {
	try {
		return { ok: true, change: parse(input) };
	} catch (error) {
		if (error instanceof Refusal) return { ok: false, reason: error.reason };
		throw error;
	}
}
