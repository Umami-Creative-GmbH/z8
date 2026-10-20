import "server-only";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import { auditLog, employee, team } from "@/db/schema";
import { drivingLicenceIntendedDriverAssignment } from "@/db/schema/driving-licence-intended-drivers";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type { DrivingLicenceActor } from "./context";
import { assertDrivingLicenceControlOn } from "./control-state";
import type {
	DrivingLicenceEndingPreview,
	IntendedDriverAdminData,
	IntendedDriverAssignment,
	IntendedDriverAssignmentTarget,
} from "./intended-driver-rules";
import { lockDrivingLicenceOrganization } from "./locks";
import {
	beginDrivingLicenceIntendedDriverChange,
	type DrivingLicenceIntendedDriverChange,
	drivingLicenceEndingToken,
	endDrivingAuthorizationNoLongerIntended,
	previewDrivingLicenceEndingByRollback,
	previewDrivingLicenceIntendedDriverChange,
} from "./no-longer-intended";
import { DrivingLicenceStalePreviewError } from "./stale-preview";
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
/**
 * The token of the preview the admin confirmed (#1425), also when it listed nobody. A save
 * without it, or one that ends something else, is refused with `stale_preview`.
 */
const previewToken = z
	.string()
	.regex(/^[0-9a-f]{64}$/)
	.optional();
const assignmentChange = {
	target: assignmentTarget,
	value: z.enum(["required", "not_required"]),
};
export const intendedDriverAssignmentPreviewInput = z.strictObject(assignmentChange);
export const intendedDriverAssignmentInput = z.strictObject({ ...assignmentChange, previewToken });
export const intendedDriverRemovalPreviewInput = z.strictObject({ assignmentId: z.uuid() });
export const intendedDriverRemovalInput = z.strictObject({ assignmentId: z.uuid(), previewToken });

/**
 * Locks the organization and refuses while driving licence control is off: assignments are
 * kept then, but only the Retention & holds settings are offered.
 */
async function beginAssignmentChange(tx: DrivingLicenceTransaction, organizationId: string) {
	await lockDrivingLicenceOrganization(tx, organizationId);
	await assertDrivingLicenceControlOn(tx, organizationId);
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

type AssignmentInput = z.infer<typeof intendedDriverAssignmentPreviewInput>;
type RemovalInput = z.infer<typeof intendedDriverRemovalPreviewInput>;
type AssignmentWrite = {
	assignmentId: string;
	change: DrivingLicenceIntendedDriverChange | null;
};

/**
 * Runs an assignment write and ends the authorizations of employees who stop being intended
 * drivers through it (#1425), in one locked transaction. The `previewToken` must match what
 * is ended, so the admin's confirmation can't go stale; a save without one is refused too.
 */
async function saveAssignmentChange(
	actor: DrivingLicenceActor,
	token: string | undefined,
	write: (tx: DrivingLicenceTransaction, now: Instant) => Promise<AssignmentWrite>,
) {
	return db.transaction(async (tx) => {
		const now = systemClock.nowInstant();
		const { assignmentId, change } = await write(tx, now);
		const endings = await previewDrivingLicenceIntendedDriverChange(tx, change, now);
		if (token !== drivingLicenceEndingToken(endings)) throw new DrivingLicenceStalePreviewError();
		if (change && endings.length)
			await endDrivingAuthorizationNoLongerIntended(tx, {
				organizationId: actor.organizationId,
				endings,
				actorUserId: actor.userId,
				now,
			});
		return { assignmentId };
	});
}

/** The same write in a transaction that is rolled back: who would lose which classes. */
async function previewAssignmentChange(
	write: (tx: DrivingLicenceTransaction, now: Instant) => Promise<AssignmentWrite>,
): Promise<DrivingLicenceEndingPreview> {
	const employees = await previewDrivingLicenceEndingByRollback((rollBack) =>
		db.transaction(async (tx) => {
			const now = systemClock.nowInstant();
			const { change } = await write(tx, now);
			rollBack(await previewDrivingLicenceIntendedDriverChange(tx, change, now));
		}),
	);
	return { employees, previewToken: drivingLicenceEndingToken(employees) };
}

/**
 * Assigns Required or Not required to the organization, a team or an employee; one row per
 * target, changed in place. Applies at once and ends the authorizations of employees who
 * stop being intended drivers. Owners and admins only (the action checks).
 */
export async function setDrivingLicenceIntendedDriverAssignment(
	actor: DrivingLicenceActor,
	raw: unknown,
): Promise<{ assignmentId: string }> {
	const input = intendedDriverAssignmentInput.parse(raw);
	return saveAssignmentChange(actor, input.previewToken, (tx, now) =>
		writeAssignment(tx, actor, input, now),
	);
}

/** Read-only: who would lose which class authorizations if this assignment were saved. */
export async function previewDrivingLicenceIntendedDriverAssignment(
	actor: DrivingLicenceActor,
	raw: unknown,
): Promise<DrivingLicenceEndingPreview> {
	const input = intendedDriverAssignmentPreviewInput.parse(raw);
	return previewAssignmentChange((tx, now) => writeAssignment(tx, actor, input, now));
}

async function writeAssignment(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
	{ target, value }: AssignmentInput,
	nowInstant: Instant,
): Promise<AssignmentWrite> {
	const required = value === "required";
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
	if (existing?.required === required) return { assignmentId: existing.id, change: null };
	const now = dateFromInstant(nowInstant);
	const change = await beginDrivingLicenceIntendedDriverChange(
		tx,
		organizationId,
		nowInstant,
		target.type === "employee" ? [target.employeeId] : undefined,
	);
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
	return { assignmentId, change };
}

/**
 * Removes one assignment of the organization; the next broader assignment then applies, and
 * the authorizations of employees who stop being intended drivers end.
 */
export async function removeDrivingLicenceIntendedDriverAssignment(
	actor: DrivingLicenceActor,
	raw: unknown,
): Promise<{ assignmentId: string }> {
	const input = intendedDriverRemovalInput.parse(raw);
	return saveAssignmentChange(actor, input.previewToken, (tx, now) =>
		writeRemoval(tx, actor, input, now),
	);
}

/** Read-only: who would lose which class authorizations if this assignment were removed. */
export async function previewDrivingLicenceIntendedDriverRemoval(
	actor: DrivingLicenceActor,
	raw: unknown,
): Promise<DrivingLicenceEndingPreview> {
	const input = intendedDriverRemovalPreviewInput.parse(raw);
	return previewAssignmentChange((tx, now) => writeRemoval(tx, actor, input, now));
}

async function writeRemoval(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
	{ assignmentId }: RemovalInput,
	now: Instant,
): Promise<AssignmentWrite> {
	const { organizationId } = actor;
	await beginAssignmentChange(tx, organizationId);
	const table = drivingLicenceIntendedDriverAssignment;
	const [target] = await tx
		.select({ employeeId: table.employeeId })
		.from(table)
		.where(and(eq(table.organizationId, organizationId), eq(table.id, assignmentId)));
	if (!target) throw new Error("assignment_not_found");
	const change = await beginDrivingLicenceIntendedDriverChange(
		tx,
		organizationId,
		now,
		target.employeeId ? [target.employeeId] : undefined,
	);
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
	return { assignmentId: removed.id, change };
}
