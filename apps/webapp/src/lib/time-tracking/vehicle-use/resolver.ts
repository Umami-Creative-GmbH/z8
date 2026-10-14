import "server-only";

import { and, eq, or } from "drizzle-orm";
import { employee, vehicleUseAssignment } from "@/db/schema";
import { type VehicleUseMode, vehicleUseAssignmentRule, vehicleUseModeFor } from "./policy";
import { readVehicleUseSettings, type VehicleUseClient } from "./store";

/**
 * Whether vehicle use is off, asked or expected for one employee of one
 * organization (#1119), from the organization's current configuration and the
 * employee's primary team, filtered by `organizationId`. An employee outside the
 * organization resolves to off.
 *
 * The configuration is not effective-dated: the answer for any instant is the
 * current one. Switching the organization off therefore stops asking and stops
 * flagging driving details missing at once, also for earlier work.
 *
 * Inside a clock command's work transaction pass `{ lock: "share" }`, so a
 * concurrent configuration change waits for the command to commit.
 */
export async function resolveVehicleUseMode(
	db: VehicleUseClient,
	subject: { organizationId: string; employeeId: string },
	options: { lock?: "share" } = {},
): Promise<VehicleUseMode> {
	const { organizationId, employeeId } = subject;
	const settings = await readVehicleUseSettings(db, organizationId, options);
	if (!settings.enabled) return "off";

	const [subjectRow] = await db
		.select({ teamId: employee.teamId })
		.from(employee)
		.where(and(eq(employee.organizationId, organizationId), eq(employee.id, employeeId)))
		.limit(1);
	if (!subjectRow) return "off";

	const teamId = subjectRow.teamId;
	const rows = await db
		.select({
			assignmentType: vehicleUseAssignment.assignmentType,
			teamId: vehicleUseAssignment.teamId,
			employeeId: vehicleUseAssignment.employeeId,
			mode: vehicleUseAssignment.mode,
		})
		.from(vehicleUseAssignment)
		.where(
			and(
				eq(vehicleUseAssignment.organizationId, organizationId),
				or(
					eq(vehicleUseAssignment.assignmentType, "organization"),
					eq(vehicleUseAssignment.employeeId, employeeId),
					teamId ? eq(vehicleUseAssignment.teamId, teamId) : undefined,
				),
			),
		);
	return vehicleUseModeFor(
		{ employeeId, teamId },
		{ enabled: settings.enabled, assignments: rows.map(vehicleUseAssignmentRule) },
	);
}
