import "server-only";

import { and, eq } from "drizzle-orm";
import { organizationVehicle, travelExpenseReportItem } from "@/db/schema";
import { ValidationError } from "@/lib/effect/errors";
import type { WorkTransactionClient } from "../work-transaction";
import { resolveVehicleUseMode } from "./resolver";
import { splitWorkVehicleUse } from "./split-vehicle-use";
import {
	buildWorkVehicleUse,
	organizationVehicleIdOf,
	type WorkVehicleUse,
	type WorkVehicleUseEntry,
} from "./work-vehicle-use";
import type { WorkVehicleUseChangeRefusalCode } from "./work-vehicle-use-refusals";

export type { WorkVehicleUseChangeRefusalCode } from "./work-vehicle-use-refusals";

const MESSAGES: Record<WorkVehicleUseChangeRefusalCode, string> = {
	end_before_start: "The end reading cannot be below the start reading",
	invalid_reading: "Odometer readings must be whole kilometres",
	invalid_distance: "The driven distance must be whole kilometres",
	invalid_vehicle: "Choose an organization vehicle or your own vehicle",
	vehicle_use_off: "Vehicle use is not recorded for this employee",
	vehicle_not_found: "The vehicle was not found",
	vehicle_archived: "The vehicle is archived and can no longer be picked",
	split_value_out_of_range: "The kilometres at the split must lie within the work's kilometres",
	work_period_distance_claimed:
		"The work's distance is on an expense item; remove the item before splitting the work",
};

export function workVehicleUseRefusal(code: WorkVehicleUseChangeRefusalCode): ValidationError {
	return new ValidationError({
		message: MESSAGES[code],
		field: "vehicleUse",
		refusal: code,
	});
}

/** The refusal code of a vehicle use refusal, or null for any other error. */
export function workVehicleUseRefusalCodeOf(
	error: unknown,
): WorkVehicleUseChangeRefusalCode | null {
	return error instanceof ValidationError && error.field === "vehicleUse" && error.refusal
		? (error.refusal as WorkVehicleUseChangeRefusalCode)
		: null;
}

/** Entered vehicle use, validated and derived, or the refusal thrown. */
export function parseEnteredWorkVehicleUse(entry: WorkVehicleUseEntry): WorkVehicleUse {
	const built = buildWorkVehicleUse(entry);
	if (!built.ok) throw workVehicleUseRefusal(built.code);
	return built.use;
}

type Client = Pick<WorkTransactionClient, "select">;

/**
 * Re-checks a change of an employee's vehicle use under the writer's locks
 * (#1120): vehicle use must be asked or expected for the employee (otherwise
 * existing vehicle use is read-only), and a newly picked organization vehicle
 * must be one of the organization's vehicles and not archived. Keeping the
 * vehicle already recorded is always allowed, even once it is archived. The
 * configuration and the vehicle are read `FOR SHARE`.
 */
export async function assertWorkVehicleUseChangeAllowed(
	tx: Client,
	input: {
		organizationId: string;
		employeeId: string;
		previous: WorkVehicleUse | null;
		resulting: WorkVehicleUse | null;
	},
): Promise<void> {
	const mode = await resolveVehicleUseMode(
		tx as Parameters<typeof resolveVehicleUseMode>[0],
		{ organizationId: input.organizationId, employeeId: input.employeeId },
		{ lock: "share" },
	);
	if (mode === "off") throw workVehicleUseRefusal("vehicle_use_off");
	const vehicleId = organizationVehicleIdOf(input.resulting);
	if (!vehicleId || vehicleId === organizationVehicleIdOf(input.previous)) return;
	await assertVehiclePickable(tx, input.organizationId, vehicleId);
}

/**
 * The vehicle use of both halves of a user's split (#1126). The vehicle always
 * carries over, also while vehicle use is off; a value at the split changes
 * kilometres, so it needs vehicle use asked or expected for the employee. Work
 * whose distance is on an expense item is refused (`work_period_distance_claimed`,
 * #807 decision 6): a work period's distance is claimed at most once, so it can't
 * be divided until the item is removed.
 */
export async function resolveWorkVehicleUseSplit(
	tx: Client,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		use: WorkVehicleUse | null;
		value: number | null | undefined;
	},
): Promise<{ retained: WorkVehicleUse | null; generated: WorkVehicleUse | null }> {
	const refusal = await workVehicleUseSplitRefusal(tx, input);
	if (refusal) throw workVehicleUseRefusal(refusal);
	const split = splitWorkVehicleUse(input.use, input.value);
	if (!split.ok) throw workVehicleUseRefusal(split.code);
	return { retained: split.retained, generated: split.generated };
}

/**
 * What the database says against dividing work's vehicle use (#1126, #1131):
 * its distance claimed on an expense item, or a value at the split while
 * vehicle use is off for the employee. Null when nothing does; the kilometres
 * themselves are divided by the pure `splitWorkVehicleUse`.
 */
export async function workVehicleUseSplitRefusal(
	tx: Client,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		use: WorkVehicleUse | null;
		value: number | null | undefined;
	},
): Promise<WorkVehicleUseChangeRefusalCode | null> {
	const [claim] = await tx
		.select({ id: travelExpenseReportItem.id })
		.from(travelExpenseReportItem)
		.where(
			and(
				eq(travelExpenseReportItem.organizationId, input.organizationId),
				eq(travelExpenseReportItem.sourceWorkPeriodId, input.workPeriodId),
			),
		)
		.limit(1);
	if (claim) return "work_period_distance_claimed";
	if (input.value !== null && input.value !== undefined && input.use) {
		const mode = await resolveVehicleUseMode(
			tx as Parameters<typeof resolveVehicleUseMode>[0],
			{ organizationId: input.organizationId, employeeId: input.employeeId },
			{ lock: "share" },
		);
		if (mode === "off") return "vehicle_use_off";
	}
	return null;
}

/** A vehicle of the organization that is not archived, share-locked. */
export async function assertVehiclePickable(
	tx: Client,
	organizationId: string,
	vehicleId: string,
): Promise<void> {
	const [vehicle] = await tx
		.select({ archivedAt: organizationVehicle.archivedAt })
		.from(organizationVehicle)
		.where(
			and(
				eq(organizationVehicle.id, vehicleId),
				eq(organizationVehicle.organizationId, organizationId),
			),
		)
		.for("share");
	if (!vehicle) throw workVehicleUseRefusal("vehicle_not_found");
	if (vehicle.archivedAt) throw workVehicleUseRefusal("vehicle_archived");
}
