import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { organizationVehicle } from "@/db/schema";
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

/**
 * Whether one employee's work asks for vehicle use, and the vehicles to pick
 * from or to name recorded vehicle use with.
 */
export async function loadWorkVehicleUseFormContext(
	reader: VehicleUseClient,
	input: { organizationId: string; employeeId: string; recordedVehicleIds?: readonly string[] },
): Promise<WorkVehicleUseFormContext> {
	const mode = await resolveVehicleUseMode(reader, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
	});
	const recorded = input.recordedVehicleIds ?? [];
	// With vehicle use off, only recorded vehicles need names (read-only display).
	if (mode === "off" && recorded.length === 0) return { mode, vehicles: [] };
	const vehicles = await listWorkVehicleOptions(reader, input.organizationId, recorded);
	return {
		mode,
		vehicles: mode === "off" ? vehicles.filter((vehicle) => recorded.includes(vehicle.id)) : vehicles,
	};
}
