"use server";

import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { user } from "@/db/auth-schema";
import { employee, team, vehicleUseAssignment } from "@/db/schema";
import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";
import {
	formerSinceDate,
	isFormerEmployee,
	onCurrentRoster,
} from "@/lib/employee-lifecycle/current-roster";
import { formerSinceField } from "@/lib/employee-lifecycle/former-since";
import { runVehicleUseAction } from "@/lib/time-tracking/vehicle-use/action-runner";
import {
	type VehicleUseActionResult,
	type VehicleUseErrorCode,
	VehicleUseRefusal,
} from "@/lib/time-tracking/vehicle-use/errors";
import { isVehicleUseMode, type VehicleUseMode } from "@/lib/time-tracking/vehicle-use/policy";
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

export async function getVehicleUseAdminDataAction(): Promise<
	VehicleUseActionResult<VehicleUseAdminData>
> {
	return runVehicleUseAction("vehicleUse.adminData", async (db) => {
		const { organizationId } = await requireVehicleUseAdmin();
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
	});
}

export async function saveVehicleUseSettingsAction(input: {
	enabled: boolean;
}): Promise<VehicleUseActionResult<VehicleUseSettings>> {
	return runVehicleUseAction("vehicleUse.saveSettings", async (db) => {
		const { organizationId, userId } = await requireVehicleUseAdmin();
		const settings = await db.transaction((tx) =>
			saveVehicleUseSettings(tx, {
				organizationId,
				actorUserId: userId,
				settings: { enabled: input?.enabled === true },
			}),
		);
		revalidatePath(SETTINGS_PATH);
		return settings;
	});
}

export async function setVehicleUseAssignmentAction(
	input: SetVehicleUseAssignmentInput,
): Promise<VehicleUseActionResult<{ assignmentId: string }>> {
	return runVehicleUseAction("vehicleUse.setAssignment", async (db) => {
		const { organizationId, userId } = await requireVehicleUseAdmin();
		const target = parseTarget(input?.target);
		const mode = input?.mode;
		if (!isVehicleUseMode(mode)) {
			throw new VehicleUseRefusal("invalid_mode", "Choose off, asked or expected.");
		}
		const result = await db.transaction((tx) =>
			setVehicleUseAssignment(tx, { organizationId, actorUserId: userId, target, mode }),
		);
		revalidatePath(SETTINGS_PATH);
		return result;
	});
}

export async function removeVehicleUseAssignmentAction(input: {
	assignmentId: string;
}): Promise<VehicleUseActionResult<{ assignmentId: string }>> {
	return runVehicleUseAction("vehicleUse.removeAssignment", async (db) => {
		const { organizationId, userId } = await requireVehicleUseAdmin();
		const assignmentId = parseUuid(input?.assignmentId, "assignmentId", "assignment_not_found");
		await db.transaction((tx) =>
			removeVehicleUseAssignment(tx, { organizationId, actorUserId: userId, assignmentId }),
		);
		revalidatePath(SETTINGS_PATH);
		return { assignmentId };
	});
}

/** Organization owners and admins of the active organization only. */
async function requireVehicleUseAdmin(): Promise<{ organizationId: string; userId: string }> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId ?? null;
	if (!authContext || !organizationId || !(await canManageCurrentOrganizationSettings())) {
		throw new VehicleUseRefusal(
			"admin_only",
			"Only organization owners and admins can manage vehicle use.",
		);
	}
	return { organizationId, userId: authContext.user.id };
}

function parseTarget(value: unknown): VehicleUseAssignmentTarget {
	const target = value as Partial<{ type: string; teamId: unknown; employeeId: unknown }> | null;
	if (target?.type === "organization") return { type: "organization" };
	if (target?.type === "team") return { type: "team", teamId: parseUuid(target.teamId, "teamId") };
	if (target?.type === "employee") {
		return { type: "employee", employeeId: parseUuid(target.employeeId, "employeeId") };
	}
	throw new VehicleUseRefusal("invalid_target", "Choose who the assignment applies to.");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(
	value: unknown,
	field: string,
	code: VehicleUseErrorCode = "invalid_selection",
): string {
	if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
		throw new VehicleUseRefusal(code, `Invalid selection: ${field}.`);
	}
	return value;
}
