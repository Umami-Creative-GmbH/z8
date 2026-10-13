import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, organizationVehicle, team, vehicleUseAssignment } from "@/db/schema";
import {
	readVehicleUseSettings,
	type VehicleUseClient,
} from "@/lib/time-tracking/vehicle-use/store";
import type { WorksCouncilReviewVisibility } from "./review-identity";
import {
	buildVehicleUseReview,
	type VehicleUseReview,
	type VehicleUseReviewSource,
} from "./vehicle-use-review";

/**
 * Loads the works-council portal's vehicle use section (#1130) for one
 * organization. Every query is filtered by `organizationId`. It reads
 * configuration, employees' teams and vehicle counts only: never work, so no
 * odometer reading or driven distance can reach the section.
 */
export async function loadVehicleUseReviewSource(
	db: VehicleUseClient,
	organizationId: string,
): Promise<VehicleUseReviewSource> {
	const [settings, assignments, employees, vehicles] = await Promise.all([
		readVehicleUseSettings(db, organizationId),
		db
			.select({
				id: vehicleUseAssignment.id,
				assignmentType: vehicleUseAssignment.assignmentType,
				teamId: vehicleUseAssignment.teamId,
				teamName: team.name,
				employeeId: vehicleUseAssignment.employeeId,
				mode: vehicleUseAssignment.mode,
			})
			.from(vehicleUseAssignment)
			.leftJoin(
				team,
				and(
					eq(team.id, vehicleUseAssignment.teamId),
					eq(team.organizationId, vehicleUseAssignment.organizationId),
				),
			)
			.where(eq(vehicleUseAssignment.organizationId, organizationId))
			.orderBy(asc(vehicleUseAssignment.priority), asc(vehicleUseAssignment.createdAt)),
		db
			.select({ employeeId: employee.id, teamId: employee.teamId })
			.from(employee)
			.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true))),
		db
			// count(column) counts the non-null values: the archived vehicles.
			.select({ total: count(), archived: count(organizationVehicle.archivedAt) })
			.from(organizationVehicle)
			.where(eq(organizationVehicle.organizationId, organizationId)),
	]);

	const referencedEmployeeIds = [
		...new Set(assignments.flatMap((row) => (row.employeeId ? [row.employeeId] : []))),
	];
	const names =
		referencedEmployeeIds.length === 0
			? []
			: await db
					.select({
						employeeId: employee.id,
						userName: user.name,
						employeeNumber: employee.employeeNumber,
					})
					.from(employee)
					.leftJoin(user, eq(user.id, employee.userId))
					.where(
						and(
							eq(employee.organizationId, organizationId),
							inArray(employee.id, referencedEmployeeIds),
						),
					);

	return {
		settings,
		assignments,
		employees,
		employeeNames: Object.fromEntries(
			names.flatMap((row) => {
				const name = row.userName?.trim() || row.employeeNumber?.trim();
				return name ? [[row.employeeId, name] as const] : [];
			}),
		),
		vehicles: {
			active: (vehicles[0]?.total ?? 0) - (vehicles[0]?.archived ?? 0),
			archived: vehicles[0]?.archived ?? 0,
		},
	};
}

/** The section for the portal page and the review export. */
export async function loadWorksCouncilVehicleUseReview(input: {
	organizationId: string;
	settings: WorksCouncilReviewVisibility;
	db?: VehicleUseClient;
}): Promise<VehicleUseReview> {
	const source = await loadVehicleUseReviewSource(input.db ?? defaultDb, input.organizationId);
	return buildVehicleUseReview(source, {
		identityVisibility: input.settings.identityVisibility,
		minimumAggregationThreshold: input.settings.minimumAggregationThreshold,
	});
}
