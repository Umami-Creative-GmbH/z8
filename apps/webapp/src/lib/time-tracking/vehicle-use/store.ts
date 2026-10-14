import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { auditLog, employee, team, vehicleUseAssignment, vehicleUseSetting } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { WorkTransactionClient } from "../work-transaction";
import { VehicleUseRefusal } from "./errors";
import type { VehicleUseMode } from "./policy";

/**
 * Vehicle use enablement writes and reads (#1119). Every function takes the
 * caller's client: a transaction for writes, so each write and its audit entry
 * commit together. Every query is filtered by `organizationId`.
 *
 * Configuration writes (switch and assignments) lock the organization's
 * settings row `FOR UPDATE`; a reader can take it `FOR SHARE`, so it never
 * interleaves with a configuration change.
 */
export type VehicleUseClient = Pick<
	WorkTransactionClient,
	"select" | "insert" | "update" | "delete"
>;

export type VehicleUseSettings = { enabled: boolean };

export type VehicleUseAssignmentTarget =
	| { type: "organization" }
	| { type: "team"; teamId: string }
	| { type: "employee"; employeeId: string };

export type VehicleUseAssignmentRow = {
	id: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	mode: VehicleUseMode;
};

const DEFAULT_VEHICLE_USE_SETTINGS: VehicleUseSettings = { enabled: false };

/**
 * The organization's switch, or off while it has never saved one.
 * `{ lock: "share" }` reads the row `FOR SHARE`.
 */
export async function readVehicleUseSettings(
	db: VehicleUseClient,
	organizationId: string,
	options: { lock?: "share" } = {},
): Promise<VehicleUseSettings> {
	const query = db
		.select({ enabled: vehicleUseSetting.enabled })
		.from(vehicleUseSetting)
		.where(eq(vehicleUseSetting.organizationId, organizationId))
		.limit(1)
		.$dynamic();
	const [row] = await (options.lock ? query.for("share") : query);
	return row ?? DEFAULT_VEHICLE_USE_SETTINGS;
}

/** The organization's assignments, broadest first (organization, teams, employees). */
export async function listVehicleUseAssignments(
	db: VehicleUseClient,
	organizationId: string,
): Promise<VehicleUseAssignmentRow[]> {
	return db
		.select({
			id: vehicleUseAssignment.id,
			assignmentType: vehicleUseAssignment.assignmentType,
			teamId: vehicleUseAssignment.teamId,
			employeeId: vehicleUseAssignment.employeeId,
			mode: vehicleUseAssignment.mode,
		})
		.from(vehicleUseAssignment)
		.where(eq(vehicleUseAssignment.organizationId, organizationId))
		.orderBy(asc(vehicleUseAssignment.priority), asc(vehicleUseAssignment.createdAt));
}

/** Switches vehicle use on or off for the organization; audited when it changes. */
export async function saveVehicleUseSettings(
	tx: VehicleUseClient,
	input: { organizationId: string; actorUserId: string; settings: VehicleUseSettings },
): Promise<VehicleUseSettings> {
	const row = await lockSettingsRow(tx, input.organizationId);
	const next: VehicleUseSettings = { enabled: input.settings.enabled };
	if (row.enabled === next.enabled) return next;

	await tx
		.update(vehicleUseSetting)
		.set({ enabled: next.enabled, updatedBy: input.actorUserId })
		.where(eq(vehicleUseSetting.organizationId, input.organizationId));
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "vehicle_use_setting",
		entityId: row.id,
		action: AuditAction.VEHICLE_USE_SETTINGS_CHANGED,
		performedBy: input.actorUserId,
		changes: JSON.stringify({ from: { enabled: row.enabled }, to: next }),
	});
	return next;
}

/** Assigns a vehicle use mode to the organization, a team or an employee; one row per target. */
export async function setVehicleUseAssignment(
	tx: VehicleUseClient,
	input: {
		organizationId: string;
		actorUserId: string;
		target: VehicleUseAssignmentTarget;
		mode: VehicleUseMode;
	},
): Promise<{ assignmentId: string }> {
	const { organizationId, target } = input;
	await lockSettingsRow(tx, organizationId);
	await assertTargetInOrganization(tx, organizationId, target);

	const targetFilter =
		target.type === "organization"
			? eq(vehicleUseAssignment.assignmentType, "organization")
			: target.type === "team"
				? eq(vehicleUseAssignment.teamId, target.teamId)
				: eq(vehicleUseAssignment.employeeId, target.employeeId);
	const [existing] = await tx
		.select({ id: vehicleUseAssignment.id, mode: vehicleUseAssignment.mode })
		.from(vehicleUseAssignment)
		.where(and(eq(vehicleUseAssignment.organizationId, organizationId), targetFilter))
		.limit(1);

	let assignmentId: string;
	if (existing) {
		if (existing.mode === input.mode) return { assignmentId: existing.id };
		await tx
			.update(vehicleUseAssignment)
			.set({ mode: input.mode })
			.where(
				and(
					eq(vehicleUseAssignment.organizationId, organizationId),
					eq(vehicleUseAssignment.id, existing.id),
				),
			);
		assignmentId = existing.id;
	} else {
		const [inserted] = await tx
			.insert(vehicleUseAssignment)
			.values({
				organizationId,
				assignmentType: target.type,
				teamId: target.type === "team" ? target.teamId : null,
				employeeId: target.type === "employee" ? target.employeeId : null,
				priority: target.type === "organization" ? 0 : target.type === "team" ? 1 : 2,
				mode: input.mode,
				createdBy: input.actorUserId,
			})
			.returning({ id: vehicleUseAssignment.id });
		assignmentId = inserted.id;
	}

	await tx.insert(auditLog).values({
		organizationId,
		entityType: "vehicle_use_assignment",
		entityId: assignmentId,
		action: AuditAction.VEHICLE_USE_ASSIGNMENT_SET,
		performedBy: input.actorUserId,
		employeeId: target.type === "employee" ? target.employeeId : null,
		changes: JSON.stringify({
			target,
			from: existing ? { mode: existing.mode } : null,
			to: { mode: input.mode },
		}),
	});

	return { assignmentId };
}

export async function removeVehicleUseAssignment(
	tx: VehicleUseClient,
	input: { organizationId: string; actorUserId: string; assignmentId: string },
): Promise<void> {
	await lockSettingsRow(tx, input.organizationId);
	const [removed] = await tx
		.delete(vehicleUseAssignment)
		.where(
			and(
				eq(vehicleUseAssignment.organizationId, input.organizationId),
				eq(vehicleUseAssignment.id, input.assignmentId),
			),
		)
		.returning();
	if (!removed) {
		throw new VehicleUseRefusal("assignment_not_found", "Vehicle use assignment not found");
	}
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "vehicle_use_assignment",
		entityId: removed.id,
		action: AuditAction.VEHICLE_USE_ASSIGNMENT_REMOVED,
		performedBy: input.actorUserId,
		employeeId: removed.employeeId,
		changes: JSON.stringify({
			from: {
				assignmentType: removed.assignmentType,
				teamId: removed.teamId,
				employeeId: removed.employeeId,
				mode: removed.mode,
			},
			to: null,
		}),
	});
}

async function lockSettingsRow(tx: VehicleUseClient, organizationId: string) {
	await tx.insert(vehicleUseSetting).values({ organizationId }).onConflictDoNothing();
	const [row] = await tx
		.select({ id: vehicleUseSetting.id, enabled: vehicleUseSetting.enabled })
		.from(vehicleUseSetting)
		.where(eq(vehicleUseSetting.organizationId, organizationId))
		.for("update");
	return row;
}

async function assertTargetInOrganization(
	tx: VehicleUseClient,
	organizationId: string,
	target: VehicleUseAssignmentTarget,
): Promise<void> {
	if (target.type === "organization") return;
	const rows =
		target.type === "team"
			? await tx
					.select({ id: team.id })
					.from(team)
					.where(and(eq(team.organizationId, organizationId), eq(team.id, target.teamId)))
					.limit(1)
			: await tx
					.select({ id: employee.id })
					.from(employee)
					.where(
						and(eq(employee.organizationId, organizationId), eq(employee.id, target.employeeId)),
					)
					.limit(1);
	if (rows.length === 0) {
		throw target.type === "team"
			? new VehicleUseRefusal("team_not_found", "Team not found")
			: new VehicleUseRefusal("employee_not_found", "Employee not found");
	}
}
