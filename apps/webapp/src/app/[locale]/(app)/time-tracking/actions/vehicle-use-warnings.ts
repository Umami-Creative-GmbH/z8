"use server";

import * as z from "zod";
import { db } from "@/db";
import { resolveManualWallClock } from "@/lib/datetime/temporal-boundaries";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import type { ServerActionResult } from "@/lib/effect/result";
import type { VehicleUseWarning } from "@/lib/time-tracking/vehicle-use/plausibility";
import { checkWorkVehicleUsePlausibility } from "@/lib/time-tracking/vehicle-use/plausibility-check";
import { resolveVehicleUseMode } from "@/lib/time-tracking/vehicle-use/resolver";
import { buildWorkVehicleUse } from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import { getCurrentEmployee, getCurrentSession } from "./auth";
import { resolveManualEntryTarget, resolveManualEntryTargetZone } from "./manual-entry-target";
import { logger } from "./shared";

const kilometres = z.number().nullable().optional();
const wallClockTime = z.string().regex(/^\d{2}:\d{2}$/);
const checkVehicleUseWarningsSchema = z.object({
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
});

export type CheckVehicleUseWarningsInput = z.input<typeof checkVehicleUseWarningsSchema>;

/**
 * Plausibility warnings (#1121) for vehicle use being entered for new work: a
 * manual entry, or a clock-in starting now (#1122). Warnings never block the
 * entry. An entry that is invalid, or an employee without vehicle use, gets none.
 */
export async function checkVehicleUseWarnings(
	input: CheckVehicleUseWarningsInput,
): Promise<ServerActionResult<{ warnings: VehicleUseWarning[] }>> {
	const parsed = checkVehicleUseWarningsSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: "Invalid input" };
	const session = await getCurrentSession();
	if (!session?.user) return { success: false, error: "Not authenticated" };
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) return { success: false, error: "Employee profile not found" };

	try {
		const target = await resolveManualEntryTarget({
			currentEmployee,
			requestedEmployeeId: parsed.data.targetEmployeeId,
		});
		if (!target.success) return target;
		const { targetEmployee } = target;
		const none = { success: true as const, data: { warnings: [] } };

		const built = buildWorkVehicleUse(parsed.data.vehicleUse);
		if (!built.ok) return none;
		const mode = await resolveVehicleUseMode(db, {
			organizationId: targetEmployee.organizationId,
			employeeId: targetEmployee.id,
		});
		if (mode === "off") return none;

		let start: Instant;
		let end: Instant | null = null;
		const manual = parsed.data.manual;
		if (manual) {
			const { timezone } = await resolveManualEntryTargetZone(targetEmployee);
			try {
				const at = (time: string) =>
					resolveManualWallClock({
						date: manual.date,
						time,
						timezone,
						disambiguation: "earlier",
					}).toInstant();
				start = at(manual.clockInTime);
				end = at(manual.clockOutTime);
			} catch {
				return none;
			}
			if (end.epochMilliseconds <= start.epochMilliseconds) return none;
		} else {
			start = systemClock.nowInstant();
		}

		const warnings = await checkWorkVehicleUsePlausibility(db, {
			organizationId: targetEmployee.organizationId,
			employeeId: targetEmployee.id,
			use: built.use,
			start,
			end,
		});
		return { success: true, data: { warnings } };
	} catch (error) {
		logger.error({ error }, "Failed to check vehicle use plausibility");
		return { success: false, error: "Failed to check vehicle use" };
	}
}
