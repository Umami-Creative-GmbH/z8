import "server-only";

import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { loadWorkVehicleUseFormContext } from "../vehicle-use/form-context";
import type { VehicleUseFactsReader } from "../vehicle-use/plausibility-check";
import type { VehicleUseClient } from "../vehicle-use/store";
import { organizationVehicleIdOf, vehicleUseFromColumns } from "../vehicle-use/work-vehicle-use";
import type { KioskVehicleUse } from "./protocol";

/**
 * The vehicle use a kiosk asks after an employee's PIN (#1123): the web clock's
 * context (#1122) plus the facts its plausibility warnings read (#1121), so the
 * kiosk pre-fills and warns without a further PIN-carrying call. Null while
 * vehicle use is off for the employee: the kiosk then asks nothing.
 *
 * While clocked in, the last end readings are those recorded before the live
 * work started, as the web clock-out's warnings read them. Every query is
 * filtered by the kiosk's organization.
 */
export async function readKioskVehicleUse(
	reader: VehicleUseClient & VehicleUseFactsReader,
	subject: { organizationId: string; employeeId: string },
): Promise<KioskVehicleUse | null> {
	const { organizationId, employeeId } = subject;
	const [live] = await reader
		.select({
			id: workPeriod.id,
			startTime: workPeriod.startTime,
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
	const liveUse = live ? vehicleUseFromColumns(live) : null;
	const liveVehicleId = organizationVehicleIdOf(liveUse);
	const context = await loadWorkVehicleUseFormContext(reader, {
		organizationId,
		employeeId,
		recordedVehicleIds: liveVehicleId ? [liveVehicleId] : [],
		...(live
			? { readingsBefore: instantFromDate(live.startTime), excludeWorkPeriodId: live.id }
			: {}),
	});
	if (context.mode === "off") return null;
	const vehicleIds = context.vehicles.map((vehicle) => vehicle.id);
	const onOtherLiveWork =
		vehicleIds.length === 0
			? []
			: await reader
					.select({ vehicleId: workPeriod.vehicleId })
					.from(workPeriod)
					.where(
						and(
							eq(workPeriod.organizationId, organizationId),
							ne(workPeriod.employeeId, employeeId),
							isNotNull(workPeriod.vehicleId),
							inArray(workPeriod.vehicleId, vehicleIds),
							eq(workPeriod.isActive, true),
							isNull(workPeriod.endTime),
							isNull(workPeriod.deletedAt),
						),
					);
	return {
		mode: context.mode,
		vehicles: context.vehicles,
		suggestedVehicleIds: context.suggestedVehicleIds ?? [],
		lastEndKmByVehicleId: context.lastEndKmByVehicleId ?? {},
		vehiclesOnOtherLiveWork: vehicleIds.filter((id) =>
			onOtherLiveWork.some((row) => row.vehicleId === id),
		),
		live: liveUse,
	};
}
