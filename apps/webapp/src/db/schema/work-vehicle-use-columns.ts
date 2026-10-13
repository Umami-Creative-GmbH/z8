import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	check,
	foreignKey,
	index,
	integer,
	text,
	uuid,
} from "drizzle-orm/pg-core";
import { organizationVehicle } from "./vehicle";

/**
 * Vehicle use on work (#1120, spec #807; Time Tracking glossary "Driving"): the
 * same five columns on `work_period` and on its canonical `time_record_work`, as
 * the work location is. The rules live in
 * `src/lib/time-tracking/vehicle-use/work-vehicle-use.ts`; the database keeps
 * the shape:
 * - `vehicle_kind` is `organization` (with `vehicle_id`) or `own` (without);
 * - readings and distance need a vehicle and are whole, non-negative kilometres;
 * - with both readings the end is not below the start and the distance is
 *   their difference; with only a start reading there is no distance yet.
 *
 * The vehicle reference has no cascade (no action), so an organization vehicle
 * recorded on work cannot be deleted (#1118 maps the refusal to `vehicle_used`),
 * while deleting the whole organization still removes both.
 */
export function workVehicleUseColumns() {
	return {
		vehicleKind: text("vehicle_kind").$type<"organization" | "own">(),
		vehicleId: uuid("vehicle_id"),
		odometerStartKm: integer("odometer_start_km"),
		odometerEndKm: integer("odometer_end_km"),
		drivenDistanceKm: integer("driven_distance_km"),
	};
}

type VehicleUseTable = {
	organizationId: AnyPgColumn;
	vehicleKind: AnyPgColumn;
	vehicleId: AnyPgColumn;
	odometerStartKm: AnyPgColumn;
	odometerEndKm: AnyPgColumn;
	drivenDistanceKm: AnyPgColumn;
};

export function workVehicleUseConstraints(prefix: string, table: VehicleUseTable) {
	const start = table.odometerStartKm;
	const end = table.odometerEndKm;
	const distance = table.drivenDistanceKm;
	return [
		foreignKey({
			name: `${prefix}_vehicle_fk`,
			columns: [table.vehicleId, table.organizationId],
			foreignColumns: [organizationVehicle.id, organizationVehicle.organizationId],
		}),
		index(`${prefix}_org_vehicleId_idx`).on(table.organizationId, table.vehicleId),
		check(
			`${prefix}_vehicle_kind_chk`,
			sql`(${table.vehicleKind} IS NULL OR ${table.vehicleKind} IN ('organization', 'own')) AND (${table.vehicleId} IS NOT NULL) = (${table.vehicleKind} IS NOT DISTINCT FROM 'organization')`,
		),
		check(
			`${prefix}_vehicle_readings_chk`,
			sql`(${table.vehicleKind} IS NOT NULL OR (${start} IS NULL AND ${end} IS NULL AND ${distance} IS NULL)) AND (${start} IS NULL OR ${start} >= 0) AND (${end} IS NULL OR ${end} >= 0) AND (${distance} IS NULL OR ${distance} >= 0) AND (${start} IS NULL OR ${end} IS NULL OR (${end} >= ${start} AND ${distance} IS NOT NULL AND ${distance} = ${end} - ${start})) AND (${start} IS NULL OR ${end} IS NOT NULL OR ${distance} IS NULL)`,
		),
	];
}
