import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { organizationVehicle } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	listAssignedVehicleIds,
	readLastRecordedEndReadings,
	type VehicleUseFactsReader,
} from "./plausibility-check";
import { resolveVehicleUseMode } from "./resolver";
import type { VehicleUseClient } from "./store";
import type { WorkVehicleOption, WorkVehicleUseFormContext } from "./work-vehicle-use";

/**
 * The vehicles an organization's pickers and displays show (#1120): every active
 * vehicle, plus the archived ones in `includeVehicleIds` (vehicle use already
 * recorded on work), active first, then by name. Filtered by `organizationId`.
 */
export async function listWorkVehicleOptions(
	reader: Pick<VehicleUseClient, "select">,
	organizationId: string,
	includeVehicleIds: readonly string[] = [],
): Promise<WorkVehicleOption[]> {
	const rows = await reader
		.select({
			id: organizationVehicle.id,
			name: organizationVehicle.name,
			licencePlate: organizationVehicle.licencePlate,
			archivedAt: organizationVehicle.archivedAt,
		})
		.from(organizationVehicle)
		.where(
			and(
				eq(organizationVehicle.organizationId, organizationId),
				includeVehicleIds.length > 0
					? or(
							isNull(organizationVehicle.archivedAt),
							inArray(organizationVehicle.id, [...includeVehicleIds]),
						)
					: isNull(organizationVehicle.archivedAt),
			),
		)
		.orderBy(
			sql`${organizationVehicle.archivedAt} IS NOT NULL`,
			asc(organizationVehicle.name),
			asc(organizationVehicle.id),
		);
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		licencePlate: row.licencePlate,
		archived: row.archivedAt !== null,
	}));
}

/** The vehicles with the suggested ones first, in their suggested order. */
function suggestedFirst(
	vehicles: WorkVehicleOption[],
	suggestedVehicleIds: readonly string[],
): WorkVehicleOption[] {
	const rank = new Map(suggestedVehicleIds.map((id, index) => [id, index]));
	return vehicles
		.map((vehicle, index) => ({ vehicle, index }))
		.sort(
			(left, right) =>
				(rank.get(left.vehicle.id) ?? suggestedVehicleIds.length + left.index) -
				(rank.get(right.vehicle.id) ?? suggestedVehicleIds.length + right.index),
		)
		.map(({ vehicle }) => vehicle);
}

/**
 * Whether one employee's work asks for vehicle use, the vehicles to pick from or
 * to name recorded vehicle use with, and what pre-fills a new entry (#1121): the
 * employee's assigned vehicles and each vehicle's last recorded end reading.
 *
 * `readingsBefore` reads the last end readings of work that ended by then (the
 * start of the work being edited); `excludeWorkPeriodId` leaves that work out.
 */
export async function loadWorkVehicleUseFormContext(
	reader: VehicleUseClient & VehicleUseFactsReader,
	input: {
		organizationId: string;
		employeeId: string;
		recordedVehicleIds?: readonly string[];
		readingsBefore?: Instant;
		excludeWorkPeriodId?: string;
	},
): Promise<WorkVehicleUseFormContext> {
	const mode = await resolveVehicleUseMode(reader, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
	});
	const recorded = input.recordedVehicleIds ?? [];
	const recordedIds = new Set(recorded);
	const empty = { suggestedVehicleIds: [], lastEndKmByVehicleId: {} };
	// With vehicle use off, only recorded vehicles need names (read-only display).
	if (mode === "off") {
		if (recorded.length === 0) return { mode, vehicles: [], ...empty };
		const vehicles = await listWorkVehicleOptions(reader, input.organizationId, recorded);
		return {
			mode,
			vehicles: vehicles.filter((vehicle) => recordedIds.has(vehicle.id)),
			...empty,
		};
	}
	// Sequential: the reader may be a transaction, which runs one query at a time.
	const vehicles = await listWorkVehicleOptions(reader, input.organizationId, recorded);
	const suggestedVehicleIds = await listAssignedVehicleIds(reader, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
	});
	const readings = await readLastRecordedEndReadings(reader, {
		organizationId: input.organizationId,
		...(input.readingsBefore ? { before: input.readingsBefore } : {}),
		...(input.excludeWorkPeriodId ? { excludeWorkPeriodId: input.excludeWorkPeriodId } : {}),
	});
	return {
		mode,
		vehicles: suggestedFirst(vehicles, suggestedVehicleIds),
		suggestedVehicleIds,
		lastEndKmByVehicleId: Object.fromEntries(readings),
	};
}
