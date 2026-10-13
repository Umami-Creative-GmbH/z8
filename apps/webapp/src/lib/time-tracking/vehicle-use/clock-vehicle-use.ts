/**
 * Vehicle use a clock command carries beside its body (#1122, spec #807; Time
 * Tracking glossary "Driving", ADR 0009), and what each clock event records
 * from it. Pure: the server, the browser and the service worker's page half
 * share these shapes.
 *
 * - A clock-in names the vehicle and, optionally, the start reading.
 * - A clock-out names the end reading or, without a start reading, the driven
 *   distance; it may also name the vehicle and start reading when none were
 *   recorded at clock-in. Absent fields keep what the work records.
 * - A break names one optional reading: the closed work's end reading and the
 *   resumed work's start reading. The vehicle carries over either way.
 *
 * A clock command is never refused or delayed for vehicle use. What cannot be
 * recorded (no vehicle, a reading out of range, an end reading below the start
 * reading) is dropped and the work keeps what it had; driving details missing
 * (#1127) then shows it.
 */
import { z } from "zod";
import { buildWorkVehicleUse, type VehicleChoice, type WorkVehicleUse } from "./work-vehicle-use";

/** One representation per vehicle: a lowercase UUID. */
const vehicleId = z
	.string()
	.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const kilometres = z.number().int().nonnegative();

/** An organization vehicle by id, or the employee's own vehicle. */
export const clockVehicleChoiceSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("own") }),
	z.strictObject({ kind: z.literal("organization"), vehicleId }),
]);

/** A clock-in's vehicle use: the vehicle, and the start reading when entered. */
export const clockInVehicleUseSchema = z.strictObject({
	vehicle: clockVehicleChoiceSchema,
	startKm: kilometres.optional(),
});

/** A clock-out's vehicle use: what it adds to the work's; at least one field. */
export const clockOutVehicleUseSchema = z
	.strictObject({
		vehicle: clockVehicleChoiceSchema.optional(),
		startKm: kilometres.optional(),
		endKm: kilometres.optional(),
		distanceKm: kilometres.optional(),
	})
	.refine((value) => Object.keys(value).length > 0);

/** A break's one reading. */
export const breakVehicleUseSchema = z.strictObject({ readingKm: kilometres });

/** Vehicle use beside a clock-in or clock-out body. */
export type ClockVehicleUse = {
	vehicle?: VehicleChoice;
	startKm?: number;
	endKm?: number;
	distanceKm?: number;
};

/** Vehicle use beside a break body. */
export type BreakVehicleUse = { readingKm: number };

/**
 * The vehicle use a clock-in or clock-out request carried, or undefined. A
 * missing or malformed one never refuses the clock event: it is dropped.
 */
export function readClockVehicleUse(value: unknown): ClockVehicleUse | undefined {
	if (value === undefined || value === null) return undefined;
	const parsed = clockOutVehicleUseSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

/** The reading a break request carried, or undefined; malformed is dropped. */
export function readBreakVehicleUse(value: unknown): BreakVehicleUse | undefined {
	if (value === undefined || value === null) return undefined;
	const parsed = breakVehicleUseSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

/** The vehicle use a clock-in starts the work with, or null for none. */
export function clockInVehicleUse(supplied: ClockVehicleUse | undefined): WorkVehicleUse | null {
	if (!supplied?.vehicle) return null;
	const built = buildWorkVehicleUse({ vehicle: supplied.vehicle, startKm: supplied.startKm });
	return built.ok ? built.use : null;
}

/**
 * The vehicle use a clock-out leaves on the work: the supplied fields over the
 * work's current ones, or the current one when that cannot be recorded.
 */
export function clockOutVehicleUse(
	current: WorkVehicleUse | null,
	supplied: ClockVehicleUse | undefined,
): WorkVehicleUse | null {
	if (!supplied) return current;
	const vehicle = supplied.vehicle ?? current?.vehicle;
	if (!vehicle) return current;
	const built = buildWorkVehicleUse({
		vehicle,
		startKm: supplied.startKm ?? current?.startKm,
		endKm: supplied.endKm ?? current?.endKm,
		distanceKm: supplied.distanceKm ?? current?.distanceKm,
	});
	return built.ok ? built.use : current;
}

/**
 * What a break records: the closed work keeps its vehicle use with the reading
 * as its end, and the resumed work takes the vehicle with the reading as its
 * start. A reading the closed work cannot take is dropped for both.
 */
export function breakVehicleUse(
	current: WorkVehicleUse | null,
	supplied: BreakVehicleUse | undefined,
): { closed: WorkVehicleUse | null; resumed: WorkVehicleUse | null } {
	if (!current) return { closed: null, resumed: null };
	const carried = { vehicle: current.vehicle, startKm: null, endKm: null, distanceKm: null };
	if (supplied === undefined) return { closed: current, resumed: carried };
	const closed = buildWorkVehicleUse({
		vehicle: current.vehicle,
		startKm: current.startKm,
		endKm: supplied.readingKm,
		distanceKm: current.distanceKm,
	});
	if (!closed.ok) return { closed: current, resumed: carried };
	return { closed: closed.use, resumed: { ...carried, startKm: supplied.readingKm } };
}
