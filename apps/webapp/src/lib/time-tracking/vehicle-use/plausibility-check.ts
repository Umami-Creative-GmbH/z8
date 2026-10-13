import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
	employee,
	organizationVehicle,
	organizationVehicleDriver,
	teamMembership,
	workPeriod,
} from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { WorkTransactionClient } from "../work-transaction";
import { type VehicleUseWarning, vehicleUsePlausibilityWarnings } from "./plausibility";
import { organizationVehicleIdOf, type WorkVehicleUse } from "./work-vehicle-use";

/**
 * The database facts behind vehicle use pre-fill and plausibility warnings
 * (#1121, spec #807). Read-only; every query is filtered by `organizationId`.
 * The manual entry and edit dialogs, the approval card and the clock clients
 * (#1122) share these reads.
 */
export type VehicleUseFactsReader = Pick<WorkTransactionClient, "select">;
type Reader = VehicleUseFactsReader;

/**
 * The active organization vehicles an employee is an assigned driver of:
 * assigned to the employee first, then to one of their teams (primary team or
 * membership), each group by name.
 */
export async function listAssignedVehicleIds(
	reader: Reader,
	subject: { organizationId: string; employeeId: string },
): Promise<string[]> {
	const { organizationId, employeeId } = subject;
	const [subjectRow] = await reader
		.select({ teamId: employee.teamId })
		.from(employee)
		.where(and(eq(employee.organizationId, organizationId), eq(employee.id, employeeId)))
		.limit(1);
	if (!subjectRow) return [];
	const memberships = await reader
		.select({ teamId: teamMembership.teamId })
		.from(teamMembership)
		.where(
			and(
				eq(teamMembership.organizationId, organizationId),
				eq(teamMembership.employeeId, employeeId),
			),
		);
	const teamIds = [
		...new Set(
			[subjectRow.teamId, ...memberships.map((row) => row.teamId)].filter((id): id is string =>
				Boolean(id),
			),
		),
	];

	const rows = await reader
		.select({
			vehicleId: organizationVehicleDriver.vehicleId,
			direct: sql<boolean>`${organizationVehicleDriver.employeeId} IS NOT NULL`,
		})
		.from(organizationVehicleDriver)
		.innerJoin(
			organizationVehicle,
			and(
				eq(organizationVehicle.id, organizationVehicleDriver.vehicleId),
				eq(organizationVehicle.organizationId, organizationVehicleDriver.organizationId),
			),
		)
		.where(
			and(
				eq(organizationVehicleDriver.organizationId, organizationId),
				isNull(organizationVehicle.archivedAt),
				or(
					eq(organizationVehicleDriver.employeeId, employeeId),
					teamIds.length > 0 ? inArray(organizationVehicleDriver.teamId, teamIds) : undefined,
				),
			),
		)
		.orderBy(
			desc(sql`${organizationVehicleDriver.employeeId} IS NOT NULL`),
			asc(organizationVehicle.name),
			asc(organizationVehicle.id),
		);
	return [...new Set(rows.map((row) => row.vehicleId))];
}

/**
 * Each organization vehicle's last recorded end reading: the end reading of the
 * latest-ending work period that records one. With `before`, only work that
 * ended by then counts; `excludeWorkPeriodId` leaves out the work being edited.
 * Deleted work never counts.
 */
export async function readLastRecordedEndReadings(
	reader: Reader,
	input: {
		organizationId: string;
		vehicleIds?: readonly string[];
		before?: Instant;
		excludeWorkPeriodId?: string;
	},
): Promise<Map<string, number>> {
	if (input.vehicleIds && input.vehicleIds.length === 0) return new Map();
	const rows = await reader
		.select({
			vehicleId: workPeriod.vehicleId,
			// The end reading of the latest-ending work per vehicle.
			endKm: sql<
				number | null
			>`(array_agg(${workPeriod.odometerEndKm} ORDER BY ${workPeriod.endTime} DESC, ${workPeriod.odometerEndKm} DESC))[1]`,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				isNotNull(workPeriod.vehicleId),
				isNotNull(workPeriod.odometerEndKm),
				isNotNull(workPeriod.endTime),
				isNull(workPeriod.deletedAt),
				input.vehicleIds ? inArray(workPeriod.vehicleId, [...input.vehicleIds]) : undefined,
				input.before ? lte(workPeriod.endTime, dateFromInstant(input.before)) : undefined,
				input.excludeWorkPeriodId ? ne(workPeriod.id, input.excludeWorkPeriodId) : undefined,
			),
		)
		.groupBy(workPeriod.vehicleId);
	const readings = new Map<string, number>();
	for (const row of rows) {
		if (row.vehicleId !== null && row.endKm !== null) {
			readings.set(row.vehicleId, Number(row.endKm));
		}
	}
	return readings;
}

/**
 * Whether another employee's live work records the vehicle and had started
 * before `until` (the end of the work being checked; none for live work).
 */
export async function isVehicleOnOtherLiveWork(
	reader: Reader,
	input: { organizationId: string; vehicleId: string; employeeId: string; until: Instant | null },
): Promise<boolean> {
	const [row] = await reader
		.select({ id: workPeriod.id })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.vehicleId, input.vehicleId),
				ne(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.endTime),
				isNull(workPeriod.deletedAt),
				input.until ? lt(workPeriod.startTime, dateFromInstant(input.until)) : undefined,
			),
		)
		.limit(1);
	return row !== undefined;
}

/**
 * Which of these vehicles another employee's live work records, in one query:
 * the batched `isVehicleOnOtherLiveWork` for a client that warns locally (the
 * kiosk, #1123). Order follows `vehicleIds`.
 */
export async function vehiclesOnOtherLiveWork(
	reader: Reader,
	input: { organizationId: string; vehicleIds: readonly string[]; employeeId: string },
): Promise<string[]> {
	if (input.vehicleIds.length === 0) return [];
	const rows = await reader
		.select({ vehicleId: workPeriod.vehicleId })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.vehicleId, [...input.vehicleIds]),
				ne(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.endTime),
				isNull(workPeriod.deletedAt),
			),
		);
	const used = new Set(rows.map((row) => row.vehicleId));
	return input.vehicleIds.filter((id) => used.has(id));
}

/**
 * The plausibility warnings for one employee's vehicle use on work from `start`
 * to `end` (null while live). `excludeWorkPeriodId` is the work being edited.
 * Warnings never refuse anything.
 */
export async function checkWorkVehicleUsePlausibility(
	reader: Reader,
	input: {
		organizationId: string;
		employeeId: string;
		use: WorkVehicleUse;
		start: Instant;
		end: Instant | null;
		excludeWorkPeriodId?: string;
	},
): Promise<VehicleUseWarning[]> {
	const vehicleId = organizationVehicleIdOf(input.use);
	let lastRecordedEndKm: number | null = null;
	let vehicleOnOtherLiveWork = false;
	// Sequential: the reader may be a transaction, which runs one query at a time.
	if (vehicleId) {
		if (input.use.startKm !== null) {
			const readings = await readLastRecordedEndReadings(reader, {
				organizationId: input.organizationId,
				vehicleIds: [vehicleId],
				before: input.start,
				...(input.excludeWorkPeriodId ? { excludeWorkPeriodId: input.excludeWorkPeriodId } : {}),
			});
			lastRecordedEndKm = readings.get(vehicleId) ?? null;
		}
		vehicleOnOtherLiveWork = await isVehicleOnOtherLiveWork(reader, {
			organizationId: input.organizationId,
			vehicleId,
			employeeId: input.employeeId,
			until: input.end,
		});
	}
	return vehicleUsePlausibilityWarnings({
		use: input.use,
		start: input.start,
		end: input.end,
		lastRecordedEndKm,
		vehicleOnOtherLiveWork,
	});
}
