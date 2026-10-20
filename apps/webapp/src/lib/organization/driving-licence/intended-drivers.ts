import "server-only";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import { auditLog, employee, team } from "@/db/schema";
import { drivingLicenceIntendedDriverAssignment } from "@/db/schema/driving-licence-intended-drivers";
import { drivingLicencePolicy } from "@/db/schema/driving-licence-policy";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type { DrivingLicenceActor } from "./context";
import type {
	IntendedDriverAdminData,
	IntendedDriverAssignment,
	IntendedDriverAssignmentTarget,
} from "./intended-driver-rules";
import { lockDrivingLicenceOrganization } from "./locks";
import type { DrivingLicenceDatabase, DrivingLicenceTransaction } from "./verifiers";

/**
 * Intended drivers (#1423, spec #1418, Organization ADR 0005). The single resolver of who
 * driving licence control applies to: the employee's own assignment, then their primary
 * team's (`employee.team_id`; other team memberships never count), then the organization
 * default; with no assignment the employee is not an intended driver. Resolution never
 * looks at employment access; callers combine it with their access checks as before.
 */

const employeeColumn = (column: "id" | "team_id" | "organization_id") =>
	sql`${sql.identifier("employee")}.${sql.identifier(column)}`;

/**
 * The resolver as a query condition over the `employee` table in scope (under its own name),
 * so bulk readers select intended drivers in one query. Scoped to `organizationId`.
 */
export function intendedDriverCondition(organizationId: string): SQL {
	return sql`(${employeeColumn("organization_id")} = ${organizationId} and coalesce(
		(select ida.required from driving_licence_intended_driver_assignment ida
			where ida.organization_id = ${organizationId} and ida.assignment_type = 'employee'
				and ida.employee_id = ${employeeColumn("id")}),
		(select ida.required from driving_licence_intended_driver_assignment ida
			where ida.organization_id = ${organizationId} and ida.assignment_type = 'team'
				and ida.team_id = ${employeeColumn("team_id")}),
		(select ida.required from driving_licence_intended_driver_assignment ida
			where ida.organization_id = ${organizationId} and ida.assignment_type = 'organization'),
		false))`;
}

/** Whether one employee of the organization is an intended driver. */
export async function isDrivingLicenceIntendedDriver(
	database: DrivingLicenceDatabase,
	input: { organizationId: string; employeeId: string },
) {
	const [row] = await database
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.id, input.employeeId),
				intendedDriverCondition(input.organizationId),
			),
		)
		.limit(1);
	return !!row;
}

/** The organization's intended drivers (optionally only `employeeId`), in one query. */
export async function listDrivingLicenceIntendedDriverIds(
	database: DrivingLicenceDatabase,
	organizationId: string,
	employeeId?: string,
) {
	const rows = await database
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, organizationId),
				employeeId ? eq(employee.id, employeeId) : undefined,
				intendedDriverCondition(organizationId),
			),
		)
		.orderBy(asc(employee.id));
	return rows.map((row) => row.id);
}

/** The organization's assignments, broadest first (organization, teams, employees). */
export async function listDrivingLicenceIntendedDriverAssignments(
	database: DrivingLicenceDatabase,
	organizationId: string,
): Promise<IntendedDriverAssignment[]> {
	const rows = await database
		.select()
		.from(drivingLicenceIntendedDriverAssignment)
		.where(eq(drivingLicenceIntendedDriverAssignment.organizationId, organizationId))
		.orderBy(
			asc(drivingLicenceIntendedDriverAssignment.priority),
			asc(drivingLicenceIntendedDriverAssignment.createdAt),
			asc(drivingLicenceIntendedDriverAssignment.id),
		);
	return rows.map((row) => ({
		id: row.id,
		assignmentType: row.assignmentType,
		teamId: row.teamId,
		employeeId: row.employeeId,
		value: row.required ? "required" : "not_required",
		createdAt: row.createdAt.toISOString(),
		createdBy: row.createdBy,
		updatedAt: row.updatedAt.toISOString(),
		updatedBy: row.updatedBy,
	}));
}

/** Approved members with organization access: the employees an assignment can name. */
export async function listDrivingLicenceEmployees(
	database: DrivingLicenceDatabase,
	organizationId: string,
) {
	return database
		.select({ id: employee.id, name: user.name })
		.from(employee)
		.innerJoin(
			member,
			and(
				eq(member.userId, employee.userId),
				eq(member.organizationId, employee.organizationId),
				eq(member.status, "approved"),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.organizationId, organizationId), employeeHasOrganizationAccess()))
		.orderBy(asc(user.name), asc(employee.id));
}

/** What the Intended drivers settings need: assignments, teams and assignable employees. */
export async function readDrivingLicenceIntendedDriverAdminData(
	organizationId: string,
): Promise<IntendedDriverAdminData> {
	const [assignments, teams, employees] = await Promise.all([
		listDrivingLicenceIntendedDriverAssignments(db, organizationId),
		db
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name), asc(team.id)),
		listDrivingLicenceEmployees(db, organizationId),
	]);
	return { assignments, teams, employees };
}

const assignmentTarget = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("organization") }),
	z.strictObject({ type: z.literal("team"), teamId: z.uuid() }),
	z.strictObject({ type: z.literal("employee"), employeeId: z.uuid() }),
]);
export const intendedDriverAssignmentInput = z.strictObject({
	target: assignmentTarget,
	value: z.enum(["required", "not_required"]),
});
export const intendedDriverRemovalInput = z.strictObject({ assignmentId: z.uuid() });

/**
 * Locks the organization and refuses while driving licence control is off: assignments are
 * kept then, but only the Retention & holds settings are offered.
 */
async function beginAssignmentChange(tx: DrivingLicenceTransaction, organizationId: string) {
	await lockDrivingLicenceOrganization(tx, organizationId);
	const [policy] = await tx
		.select({ enabled: drivingLicencePolicy.enabled })
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	if (!policy?.enabled) throw new Error("not_enabled");
}

async function assertTargetInOrganization(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	target: IntendedDriverAssignmentTarget,
) {
	if (target.type === "organization") return;
	if (target.type === "team") {
		const [row] = await tx
			.select({ id: team.id })
			.from(team)
			.where(and(eq(team.organizationId, organizationId), eq(team.id, target.teamId)))
			.limit(1);
		if (!row) throw new Error("team_not_found");
		return;
	}
	const [row] = await assignableEmployee(tx, organizationId, target.employeeId);
	if (!row) throw new Error("employee_not_found");
}
function assignableEmployee(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	employeeId: string,
) {
	return tx
		.select({ id: employee.id })
		.from(employee)
		.innerJoin(
			member,
			and(
				eq(member.userId, employee.userId),
				eq(member.organizationId, employee.organizationId),
				eq(member.status, "approved"),
			),
		)
		.where(
			and(
				eq(employee.organizationId, organizationId),
				eq(employee.id, employeeId),
				employeeHasOrganizationAccess(),
			),
		)
		.limit(1);
}

/**
 * Assigns Required or Not required to the organization, a team or an employee; one row per
 * target, changed in place. Applies at once. Owners and admins only (the action checks).
 */
export async function setDrivingLicenceIntendedDriverAssignment(
	actor: DrivingLicenceActor,
	raw: unknown,
): Promise<{ assignmentId: string }> {
	const { target, value } = intendedDriverAssignmentInput.parse(raw);
	const required = value === "required";
	return db.transaction(async (tx) => {
		const { organizationId } = actor;
		await beginAssignmentChange(tx, organizationId);
		await assertTargetInOrganization(tx, organizationId, target);
		const table = drivingLicenceIntendedDriverAssignment;
		const targetFilter =
			target.type === "organization"
				? eq(table.assignmentType, "organization")
				: target.type === "team"
					? eq(table.teamId, target.teamId)
					: eq(table.employeeId, target.employeeId);
		const [existing] = await tx
			.select({ id: table.id, required: table.required })
			.from(table)
			.where(and(eq(table.organizationId, organizationId), targetFilter))
			.limit(1);
		if (existing?.required === required) return { assignmentId: existing.id };
		const now = dateFromInstant(systemClock.nowInstant());
		// #1425 seam: preview and end the authorizations of employees who stop being intended
		// drivers through this change, here inside the same locked transaction.
		let assignmentId: string;
		if (existing) {
			await tx
				.update(table)
				.set({ required, updatedAt: now, updatedBy: actor.userId })
				.where(and(eq(table.organizationId, organizationId), eq(table.id, existing.id)));
			assignmentId = existing.id;
		} else {
			const [inserted] = await tx
				.insert(table)
				.values({
					organizationId,
					assignmentType: target.type,
					teamId: target.type === "team" ? target.teamId : null,
					employeeId: target.type === "employee" ? target.employeeId : null,
					priority: target.type === "organization" ? 0 : target.type === "team" ? 1 : 2,
					required,
					createdAt: now,
					createdBy: actor.userId,
					updatedAt: now,
					updatedBy: actor.userId,
				})
				.returning({ id: table.id });
			assignmentId = inserted.id;
		}
		await tx.insert(auditLog).values({
			organizationId,
			entityType: "driving_licence_intended_driver_assignment",
			entityId: assignmentId,
			action: AuditAction.DRIVING_LICENCE_INTENDED_DRIVER_SET,
			performedBy: actor.userId,
			employeeId: target.type === "employee" ? target.employeeId : null,
			changes: JSON.stringify({
				target,
				from: existing ? { required: existing.required } : null,
				to: { required },
			}),
		});
		return { assignmentId };
	});
}

/** Removes one assignment of the organization; the next broader assignment then applies. */
export async function removeDrivingLicenceIntendedDriverAssignment(
	actor: DrivingLicenceActor,
	raw: unknown,
): Promise<{ assignmentId: string }> {
	const { assignmentId } = intendedDriverRemovalInput.parse(raw);
	return db.transaction(async (tx) => {
		const { organizationId } = actor;
		await beginAssignmentChange(tx, organizationId);
		const table = drivingLicenceIntendedDriverAssignment;
		// #1425 seam: preview and end the authorizations this removal takes away, before deleting.
		const [removed] = await tx
			.delete(table)
			.where(and(eq(table.organizationId, organizationId), eq(table.id, assignmentId)))
			.returning();
		if (!removed) throw new Error("assignment_not_found");
		await tx.insert(auditLog).values({
			organizationId,
			entityType: "driving_licence_intended_driver_assignment",
			entityId: removed.id,
			action: AuditAction.DRIVING_LICENCE_INTENDED_DRIVER_REMOVED,
			performedBy: actor.userId,
			employeeId: removed.employeeId,
			changes: JSON.stringify({
				from: {
					assignmentType: removed.assignmentType,
					teamId: removed.teamId,
					employeeId: removed.employeeId,
					required: removed.required,
				},
				to: null,
			}),
		});
		return { assignmentId: removed.id };
	});
}
