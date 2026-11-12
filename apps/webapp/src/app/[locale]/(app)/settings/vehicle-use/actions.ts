"use server";

import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, team, vehicleUseAssignment } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	formerSinceDate,
	isFormerEmployee,
	onCurrentRoster,
} from "@/lib/employee-lifecycle/current-roster";
import { formerSinceField } from "@/lib/employee-lifecycle/former-since";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	assignmentIdSchema,
	assignmentTargetSchema,
} from "@/lib/time-tracking/assignment-target-schema";
import { VehicleUseRefusal } from "@/lib/time-tracking/vehicle-use/errors";
import { VEHICLE_USE_MODES, type VehicleUseMode } from "@/lib/time-tracking/vehicle-use/policy";
import {
	listVehicleUseAssignments,
	readVehicleUseSettings,
	removeVehicleUseAssignment,
	saveVehicleUseSettings,
	setVehicleUseAssignment,
	type VehicleUseAssignmentRow,
	type VehicleUseAssignmentTarget,
	type VehicleUseSettings,
} from "@/lib/time-tracking/vehicle-use/store";

export type VehicleUseAssignmentData = VehicleUseAssignmentRow;

export type VehicleUseOption = { id: string; name: string };

export type VehicleUseAdminData = {
	settings: VehicleUseSettings;
	assignments: VehicleUseAssignmentData[];
	teams: VehicleUseOption[];
	/**
	 * The current roster, and former employees an assignment names (`isFormer`,
	 * with `formerSince`: the date they left, null when not recorded, #1439).
	 */
	employees: Array<VehicleUseOption & { isFormer: boolean; formerSince?: string | null }>;
};

export type SetVehicleUseAssignmentInput = {
	target: VehicleUseAssignmentTarget;
	mode: VehicleUseMode;
};

const SETTINGS_PATH = "/settings/vehicles";

const saveSettingsSchema = z.strictObject({ enabled: z.boolean() });

const setAssignmentSchema = z.strictObject({
	target: assignmentTargetSchema,
	mode: z.enum(VEHICLE_USE_MODES, "Choose off, asked or expected."),
}) satisfies z.ZodType<SetVehicleUseAssignmentInput>;

const removeAssignmentSchema = z.strictObject({ assignmentId: assignmentIdSchema });

const revalidateSettings = Effect.sync(() => revalidatePath(SETTINGS_PATH));

export const getVehicleUseAdminDataAction = organizationAction(
	{ name: "vehicleUse.adminData", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep("vehicleUse.adminData", (db) => loadVehicleUseAdminData(db, organizationId), {
			refusal: VehicleUseRefusal,
		}),
);

/** The settings page's data; only the session organization's rows. */
async function loadVehicleUseAdminData(
	db: DatabaseClient,
	organizationId: string,
): Promise<VehicleUseAdminData> {
	const [settings, assignments, teams, employees] = await Promise.all([
		readVehicleUseSettings(db, organizationId),
		listVehicleUseAssignments(db, organizationId),
		db
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name)),
		// The current roster (#1438), plus former employees an assignment still
		// names, marked, so their row keeps its name.
		db
			.select({
				id: employee.id,
				employeeNumber: employee.employeeNumber,
				userName: user.name,
				isFormer: isFormerEmployee(employee),
				formerSince: formerSinceDate(employee),
			})
			.from(employee)
			.innerJoin(user, eq(employee.userId, user.id))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					or(
						onCurrentRoster(organizationId),
						inArray(
							employee.id,
							db
								.select({ id: vehicleUseAssignment.employeeId })
								.from(vehicleUseAssignment)
								.where(
									and(
										eq(vehicleUseAssignment.organizationId, organizationId),
										isNotNull(vehicleUseAssignment.employeeId),
									),
								),
						),
					),
				),
			)
			.orderBy(asc(user.name), asc(employee.id)),
	]);
	return {
		settings,
		assignments,
		teams,
		employees: employees.map((row) => ({
			id: row.id,
			name: row.userName?.trim() || row.employeeNumber || row.id,
			isFormer: row.isFormer,
			...formerSinceField(row.isFormer, row.formerSince),
		})),
	};
}

export const saveVehicleUseSettingsAction = organizationAction(
	{ name: "vehicleUse.saveSettings", requires: "orgAdmin", schema: saveSettingsSchema },
	({ actor, organizationId, input }) =>
		storeStep(
			"vehicleUse.saveSettings",
			(db) =>
				db.transaction((tx) =>
					saveVehicleUseSettings(tx, {
						organizationId,
						actorUserId: actor.userId,
						settings: { enabled: input.enabled },
					}),
				),
			{ refusal: VehicleUseRefusal },
		).pipe(Effect.tap(() => revalidateSettings)),
);

export const setVehicleUseAssignmentAction = organizationAction(
	{
		name: "vehicleUse.setAssignment",
		requires: "orgAdmin",
		schema: setAssignmentSchema,
		// No `addsEmployees`: switching a former employee's existing assignment must
		// still work, so the store refuses only a new one (`former_employee`, #1438).
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"vehicleUse.setAssignment",
			(db) =>
				db.transaction((tx) =>
					setVehicleUseAssignment(tx, {
						organizationId,
						actorUserId: actor.userId,
						target: input.target,
						mode: input.mode,
					}),
				),
			{ refusal: VehicleUseRefusal },
		).pipe(Effect.tap(() => revalidateSettings)),
);

export const removeVehicleUseAssignmentAction = organizationAction(
	{ name: "vehicleUse.removeAssignment", requires: "orgAdmin", schema: removeAssignmentSchema },
	({ actor, organizationId, input }) =>
		storeStep(
			"vehicleUse.removeAssignment",
			async (db) => {
				await db.transaction((tx) =>
					removeVehicleUseAssignment(tx, {
						organizationId,
						actorUserId: actor.userId,
						assignmentId: input.assignmentId,
					}),
				);
				return { assignmentId: input.assignmentId };
			},
			{ refusal: VehicleUseRefusal },
		).pipe(Effect.tap(() => revalidateSettings)),
);
