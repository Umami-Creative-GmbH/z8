import * as z from "zod";

const kilometres = z.number().nullable().optional();
const wallClockTime = z.string().regex(/^\d{2}:\d{2}$/);

/**
 * What a plausibility warning check (#1121) is asked for: the `checkVehicleUseWarnings` server
 * action and the desktop route (#1124) read the same shape. No server-only imports.
 */
export const checkVehicleUseWarningsSchema = z.object({
	/** Omit for the signed-in employee; otherwise someone they may enter work for. */
	targetEmployeeId: z.uuid().nullish(),
	vehicleUse: z.object({
		vehicle: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("own") }),
			z.object({ kind: z.literal("organization"), vehicleId: z.uuid() }),
		]),
		startKm: kilometres,
		endKm: kilometres,
		distanceKm: kilometres,
	}),
	/**
	 * Manual work on one date, in the target's timezone. Without it the work
	 * starts now and is live (a clock-in).
	 */
	manual: z
		.object({ date: z.iso.date(), clockInTime: wallClockTime, clockOutTime: wallClockTime })
		.optional(),
	/**
	 * The signed-in employee's live work a clock-out is about to end (#1122): the
	 * work runs from its start until now.
	 */
	closingWorkPeriodId: z.uuid().optional(),
});

export type CheckVehicleUseWarningsInput = z.input<typeof checkVehicleUseWarningsSchema>;

/** The desktop's request (#1124): a clock-in now, or the clock-out of its own live work. */
export const desktopVehicleUseWarningsSchema = checkVehicleUseWarningsSchema.pick({
	vehicleUse: true,
	closingWorkPeriodId: true,
});
