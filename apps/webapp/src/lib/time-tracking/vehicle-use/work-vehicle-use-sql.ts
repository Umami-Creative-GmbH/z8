import { eq, isNull, type SQL } from "drizzle-orm";
import type { timeRecordWork, workPeriod } from "@/db/schema";
import type { WorkVehicleUseColumns } from "./work-vehicle-use";

/**
 * Optimistic predicates (#1120): the row still records exactly this vehicle use.
 * For guarded updates of `work_period` or `time_record_work`.
 */
export function vehicleColumnsMatch(
	table: typeof workPeriod | typeof timeRecordWork,
	columns: WorkVehicleUseColumns,
): SQL[] {
	const match = <T>(column: Parameters<typeof eq>[0], value: T | null) =>
		value === null ? isNull(column) : eq(column, value);
	return [
		match(table.vehicleKind, columns.vehicleKind),
		match(table.vehicleId, columns.vehicleId),
		match(table.odometerStartKm, columns.odometerStartKm),
		match(table.odometerEndKm, columns.odometerEndKm),
		match(table.drivenDistanceKm, columns.drivenDistanceKm),
	];
}
