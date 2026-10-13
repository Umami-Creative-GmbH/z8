import "server-only";

import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, organizationVehicle, timeEntry, workPeriod } from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { getEmployeeBaseDisplayName } from "@/lib/employee-identity";
import { completedWorkPeriodCondition } from "./completed-work";
import {
	instantWindow,
	isWithinDayRange,
	type ReportDayRange,
	reportedWorkDay,
} from "./project-report-work";
import type { VehicleDistanceWork } from "./vehicle-distance-report";

type Reader = Pick<typeof db, "select">;

/**
 * The driving the distance per vehicle report counts (#1129): completed,
 * non-deleted work of the organization with vehicle use and a driven distance,
 * whose event-local start day (at the offset stored on its clock-in entry)
 * falls in the range. `employeeIds` null reads every employee. Archived
 * organization vehicles are kept: they stay on the work they were driven on.
 */
export async function loadVehicleDistanceWork(
	reader: Reader,
	organizationId: string,
	scope: { employeeIds: readonly string[] | null; range: ReportDayRange },
): Promise<VehicleDistanceWork[]> {
	if (scope.employeeIds?.length === 0) return [];
	const window = instantWindow(scope.range);
	const rows = await reader
		.select({
			employeeId: workPeriod.employeeId,
			userName: user.name,
			userEmail: user.email,
			vehicleKind: workPeriod.vehicleKind,
			vehicleId: organizationVehicle.id,
			vehicleName: organizationVehicle.name,
			licencePlate: organizationVehicle.licencePlate,
			archivedAt: organizationVehicle.archivedAt,
			distanceKm: workPeriod.drivenDistanceKm,
			startTime: workPeriod.startTime,
			startOffsetMinutes: timeEntry.utcOffsetMinutes,
		})
		.from(workPeriod)
		.innerJoin(
			timeEntry,
			and(
				eq(timeEntry.id, workPeriod.clockInId),
				eq(timeEntry.organizationId, workPeriod.organizationId),
			),
		)
		.innerJoin(
			employee,
			and(eq(employee.id, workPeriod.employeeId), eq(employee.organizationId, organizationId)),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			organizationVehicle,
			and(
				eq(organizationVehicle.id, workPeriod.vehicleId),
				eq(organizationVehicle.organizationId, organizationId),
			),
		)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				scope.employeeIds ? inArray(workPeriod.employeeId, [...scope.employeeIds]) : undefined,
				completedWorkPeriodCondition(),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.vehicleKind),
				isNotNull(workPeriod.drivenDistanceKm),
				gte(workPeriod.startTime, window.start),
				lt(workPeriod.startTime, window.end),
			),
		)
		.orderBy(workPeriod.startTime, workPeriod.id);

	const work: VehicleDistanceWork[] = [];
	for (const row of rows) {
		if (row.distanceKm === null) continue;
		const vehicle: VehicleDistanceWork["vehicle"] | null =
			row.vehicleKind === "own"
				? { kind: "own" }
				: row.vehicleId !== null && row.vehicleName !== null && row.licencePlate !== null
					? {
							kind: "organization",
							id: row.vehicleId,
							name: row.vehicleName,
							licencePlate: row.licencePlate,
							archived: row.archivedAt !== null,
						}
					: null;
		if (vehicle === null) continue;
		const workDay = reportedWorkDay({
			startedAt: instantFromDate(row.startTime),
			startOffsetMinutes: row.startOffsetMinutes,
		});
		if (!isWithinDayRange(workDay, scope.range)) continue;
		work.push({
			employeeId: row.employeeId,
			employeeName: getEmployeeBaseDisplayName({
				user: { name: row.userName, email: row.userEmail },
			}),
			vehicle,
			workDay,
			distanceKm: row.distanceKm,
		});
	}
	return work;
}
