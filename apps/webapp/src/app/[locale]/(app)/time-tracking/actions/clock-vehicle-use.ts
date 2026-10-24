"use server";

import { and, eq, isNull } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { describeAmendmentFailure } from "@/lib/time-tracking/amend-completed-work";
import { loadWorkVehicleUseFormContext } from "@/lib/time-tracking/vehicle-use/form-context";
import { changeLiveWorkVehicleUse } from "@/lib/time-tracking/vehicle-use/live-vehicle-use";
import { resolveVehicleUseMode } from "@/lib/time-tracking/vehicle-use/resolver";
import {
	buildWorkVehicleUse,
	organizationVehicleIdOf,
	vehicleUseFromColumns,
	type WorkVehicleUse,
	type WorkVehicleUseFormContext,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import {
	workVehicleUseRefusal,
	workVehicleUseRefusalCodeOf,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use-eligibility";
import { getCurrentEmployee, getCurrentSession } from "./auth";
import { logger } from "./shared";

/**
 * What the clock asks for vehicle use (#1122): the employee's mode, the vehicles
 * to pick with the assigned one first and each vehicle's last end reading
 * (#1121), and the live work's recorded vehicle use, if clocked in.
 */
export type ClockVehicleUseContext = WorkVehicleUseFormContext & {
	live: { workPeriodId: string; vehicleUse: WorkVehicleUse | null } | null;
};

/** The signed-in employee's vehicle use for the clock, in their active organization. */
export async function getClockVehicleUseContext(): Promise<
	ServerActionResult<ClockVehicleUseContext>
> {
	const context = await getAuthContext();
	if (!context) return { success: false, error: "Not authenticated" };
	const currentEmployee = context.employee;
	if (!currentEmployee) return { success: false, error: "Employee profile not found" };
	try {
		const { organizationId, id: employeeId } = currentEmployee;
		const [period] = await db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, organizationId),
					eq(workPeriod.employeeId, employeeId),
					isNull(workPeriod.endTime),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);
		const liveUse = period ? vehicleUseFromColumns(period) : null;
		const liveVehicleId = organizationVehicleIdOf(liveUse);
		const context = await loadWorkVehicleUseFormContext(db, {
			organizationId,
			employeeId,
			recordedVehicleIds: liveVehicleId ? [liveVehicleId] : [],
			...(period ? { excludeWorkPeriodId: period.id } : {}),
		});
		return {
			success: true,
			data: {
				...context,
				live: period ? { workPeriodId: period.id, vehicleUse: liveUse } : null,
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load clock vehicle use");
		return { success: false, error: "Failed to load vehicle use" };
	}
}

/** Operational mode and live attribution stay eager; no optional choices or reading history. */
export async function getClockVehicleUseStatus(): Promise<
	ServerActionResult<Pick<ClockVehicleUseContext, "mode" | "live">>
> {
	const context = await getAuthContext();
	if (!context) return { success: false, error: "Not authenticated" };
	const subject = context.employee;
	if (!subject) return { success: false, error: "Employee profile not found" };
	try {
		const { organizationId, id: employeeId } = subject;
		const [period] = await db
			.select({
				id: workPeriod.id,
				vehicleKind: workPeriod.vehicleKind,
				vehicleId: workPeriod.vehicleId,
				odometerStartKm: workPeriod.odometerStartKm,
				odometerEndKm: workPeriod.odometerEndKm,
				drivenDistanceKm: workPeriod.drivenDistanceKm,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, organizationId),
					eq(workPeriod.employeeId, employeeId),
					isNull(workPeriod.endTime),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);
		const mode = await resolveVehicleUseMode(db, { organizationId, employeeId });
		return {
			success: true,
			data: {
				mode,
				live: period
					? { workPeriodId: period.id, vehicleUse: vehicleUseFromColumns(period) }
					: null,
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load operational clock vehicle use");
		return { success: false, error: "Failed to load vehicle use" };
	}
}

const kilometres = z.number().nullable().optional();
const changeLiveVehicleUseSchema = z.object({
	workPeriodId: z.uuid(),
	vehicleUse: z
		.object({
			vehicle: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("own") }),
				z.object({ kind: z.literal("organization"), vehicleId: z.uuid() }),
			]),
			startKm: kilometres,
		})
		.nullable(),
});

/**
 * Changes the vehicle or start reading of the signed-in employee's live work
 * while clocked in (#1122): a live attribution amendment. The end reading and
 * distance are the clock-out's.
 */
export async function changeLiveVehicleUse(
	input: z.input<typeof changeLiveVehicleUseSchema>,
): Promise<ServerActionResult<{ vehicleUse: WorkVehicleUse | null }>> {
	const parsed = changeLiveVehicleUseSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: "Invalid input" };
	const session = await getCurrentSession();
	if (!session?.user) return { success: false, error: "Not authenticated" };
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) return { success: false, error: "Employee profile not found" };

	let vehicleUse: WorkVehicleUse | null = null;
	if (parsed.data.vehicleUse) {
		const built = buildWorkVehicleUse(parsed.data.vehicleUse);
		if (!built.ok) {
			return { success: false, error: workVehicleUseRefusal(built.code).message, code: built.code };
		}
		vehicleUse = built.use;
	}
	try {
		await changeLiveWorkVehicleUse({
			organizationId: currentEmployee.organizationId,
			employeeId: currentEmployee.id,
			actorUserId: session.user.id,
			workPeriodId: parsed.data.workPeriodId,
			vehicleUse,
		});
		return { success: true, data: { vehicleUse } };
	} catch (error) {
		const refusal = workVehicleUseRefusalCodeOf(error);
		if (refusal && error instanceof ValidationError) {
			return { success: false, error: error.message, code: refusal };
		}
		if (error instanceof NotFoundError) {
			return { success: false, error: "You are no longer clocked in", code: "not_clocked_in" };
		}
		const described = describeAmendmentFailure(error);
		if (described) return { success: false, error: described.message, code: described.code };
		if (error instanceof ValidationError || error instanceof ConflictError) {
			return { success: false, error: error.message };
		}
		logger.error({ error }, "Failed to change live vehicle use");
		return { success: false, error: "Failed to change vehicle use" };
	}
}
