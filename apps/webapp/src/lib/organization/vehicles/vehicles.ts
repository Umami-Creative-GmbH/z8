import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	approvalRequest,
	approvalWorkflow,
	auditLog,
	employee,
	organizationVehicle,
	organizationVehicleDriver,
	team,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { isConstraintViolation } from "@/lib/projects/constraint-violation";
import {
	parseVehicleChange,
	type VehicleChange,
	type VehicleDrivers,
	type VehicleRefusal,
} from "./vehicle-rules";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run a select: the app database or a transaction. */
export type VehicleReader = Pick<Transaction, "select">;

export interface VehicleDriverView {
	id: string;
	name: string;
}

export interface OrganizationVehicleView {
	id: string;
	name: string;
	licencePlate: string;
	/** Archived vehicles can't be picked any more but stay on the work they were recorded on. */
	archived: boolean;
	drivers: { employees: VehicleDriverView[]; teams: VehicleDriverView[] };
}

export type VehicleChangeOutcome =
	| { ok: true; vehicles: OrganizationVehicleView[] }
	| { ok: false; reason: VehicleRefusal };

const byName = (a: VehicleDriverView, b: VehicleDriverView) =>
	a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Every vehicle of an organization with its assigned drivers, for the settings
 * page: active vehicles by name, then archived ones.
 */
export async function listOrganizationVehicles(
	reader: VehicleReader,
	organizationId: string,
): Promise<OrganizationVehicleView[]> {
	const vehicles = await reader
		.select({
			id: organizationVehicle.id,
			name: organizationVehicle.name,
			licencePlate: organizationVehicle.licencePlate,
			archivedAt: organizationVehicle.archivedAt,
		})
		.from(organizationVehicle)
		.where(eq(organizationVehicle.organizationId, organizationId))
		.orderBy(
			sql`${organizationVehicle.archivedAt} IS NOT NULL`,
			asc(organizationVehicle.name),
			asc(organizationVehicle.id),
		);
	if (vehicles.length === 0) return [];

	const drivers = await reader
		.select({
			vehicleId: organizationVehicleDriver.vehicleId,
			employeeId: organizationVehicleDriver.employeeId,
			teamId: organizationVehicleDriver.teamId,
			userName: user.name,
			employeeNumber: employee.employeeNumber,
			teamName: team.name,
		})
		.from(organizationVehicleDriver)
		.leftJoin(
			employee,
			and(
				eq(employee.id, organizationVehicleDriver.employeeId),
				eq(employee.organizationId, organizationVehicleDriver.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			team,
			and(
				eq(team.id, organizationVehicleDriver.teamId),
				eq(team.organizationId, organizationVehicleDriver.organizationId),
			),
		)
		.where(
			and(
				eq(organizationVehicleDriver.organizationId, organizationId),
				inArray(
					organizationVehicleDriver.vehicleId,
					vehicles.map((vehicle) => vehicle.id),
				),
			),
		);

	return vehicles.map((vehicle) => {
		const own = drivers.filter((driver) => driver.vehicleId === vehicle.id);
		return {
			id: vehicle.id,
			name: vehicle.name,
			licencePlate: vehicle.licencePlate,
			archived: vehicle.archivedAt !== null,
			drivers: {
				employees: own
					.flatMap((driver) =>
						driver.employeeId
							? [
									{
										id: driver.employeeId,
										name: driver.userName?.trim() || driver.employeeNumber || driver.employeeId,
									},
								]
							: [],
					)
					.sort(byName),
				teams: own
					.flatMap((driver) =>
						driver.teamId ? [{ id: driver.teamId, name: driver.teamName ?? driver.teamId }] : [],
					)
					.sort(byName),
			},
		};
	});
}

class Refused {
	constructor(readonly reason: VehicleRefusal) {}
}

function refuse(reason: VehicleRefusal): never {
	throw new Refused(reason);
}

interface ChangeContext {
	tx: Transaction;
	organizationId: string;
	actorUserId: string;
}

type VehicleRow = typeof organizationVehicle.$inferSelect;
type ChangeOf<K extends VehicleChange["kind"]> = Extract<VehicleChange, { kind: K }>;

async function writeAudit(
	context: ChangeContext,
	vehicleId: string,
	action: AuditAction,
	changes: Record<string, unknown>,
) {
	await context.tx.insert(auditLog).values({
		organizationId: context.organizationId,
		entityType: "vehicle",
		entityId: vehicleId,
		action,
		performedBy: context.actorUserId,
		changes: JSON.stringify(changes),
	});
}

/** The vehicle of the organization, locked for this change. */
async function loadVehicle(context: ChangeContext, vehicleId: string): Promise<VehicleRow> {
	const [row] = await context.tx
		.select()
		.from(organizationVehicle)
		.where(
			and(
				eq(organizationVehicle.organizationId, context.organizationId),
				eq(organizationVehicle.id, vehicleId),
			),
		)
		.for("update")
		.limit(1);
	return row ?? refuse("vehicle_not_found");
}

async function currentDrivers(context: ChangeContext, vehicleId: string): Promise<VehicleDrivers> {
	const rows = await context.tx
		.select({
			employeeId: organizationVehicleDriver.employeeId,
			teamId: organizationVehicleDriver.teamId,
		})
		.from(organizationVehicleDriver)
		.where(
			and(
				eq(organizationVehicleDriver.organizationId, context.organizationId),
				eq(organizationVehicleDriver.vehicleId, vehicleId),
			),
		);
	return sortedDrivers({
		employeeIds: rows.flatMap((row) => (row.employeeId ? [row.employeeId] : [])),
		teamIds: rows.flatMap((row) => (row.teamId ? [row.teamId] : [])),
	});
}

function sortedDrivers(drivers: VehicleDrivers): VehicleDrivers {
	return {
		employeeIds: drivers.employeeIds.toSorted(),
		teamIds: drivers.teamIds.toSorted(),
	};
}

/** Refuses drivers that are not employees or teams of the organization. */
async function assertDriversOfOrganization(context: ChangeContext, drivers: VehicleDrivers) {
	if (drivers.employeeIds.length > 0) {
		const found = await context.tx
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, context.organizationId),
					inArray(employee.id, drivers.employeeIds),
				),
			);
		if (found.length !== drivers.employeeIds.length) refuse("driver_not_found");
	}
	if (drivers.teamIds.length > 0) {
		const found = await context.tx
			.select({ id: team.id })
			.from(team)
			.where(
				and(eq(team.organizationId, context.organizationId), inArray(team.id, drivers.teamIds)),
			);
		if (found.length !== drivers.teamIds.length) refuse("driver_not_found");
	}
}

async function replaceDrivers(context: ChangeContext, vehicleId: string, drivers: VehicleDrivers) {
	await context.tx
		.delete(organizationVehicleDriver)
		.where(
			and(
				eq(organizationVehicleDriver.organizationId, context.organizationId),
				eq(organizationVehicleDriver.vehicleId, vehicleId),
			),
		);
	const rows = [
		...drivers.employeeIds.map((employeeId) => ({ employeeId, teamId: null })),
		...drivers.teamIds.map((teamId) => ({ employeeId: null, teamId })),
	];
	if (rows.length === 0) return;
	await context.tx.insert(organizationVehicleDriver).values(
		rows.map((row) => ({
			...row,
			organizationId: context.organizationId,
			vehicleId,
			createdBy: context.actorUserId,
		})),
	);
}

async function create(context: ChangeContext, change: ChangeOf<"create">) {
	const drivers = sortedDrivers(change.drivers);
	await assertDriversOfOrganization(context, drivers);
	const [row] = await context.tx
		.insert(organizationVehicle)
		.values({
			organizationId: context.organizationId,
			name: change.name,
			licencePlate: change.licencePlate,
			createdBy: context.actorUserId,
			updatedBy: context.actorUserId,
		})
		.returning({ id: organizationVehicle.id });
	await replaceDrivers(context, row.id, drivers);
	await writeAudit(context, row.id, AuditAction.VEHICLE_CREATED, {
		after: { name: change.name, licencePlate: change.licencePlate, drivers },
	});
}

async function update(context: ChangeContext, change: ChangeOf<"update">) {
	const row = await loadVehicle(context, change.vehicleId);
	if (row.archivedAt !== null) refuse("vehicle_archived");
	const drivers = sortedDrivers(change.drivers);
	await assertDriversOfOrganization(context, drivers);

	const before = {
		name: row.name,
		licencePlate: row.licencePlate,
		drivers: await currentDrivers(context, row.id),
	};
	const after = { name: change.name, licencePlate: change.licencePlate, drivers };
	const changedKeys = (Object.keys(after) as (keyof typeof after)[]).filter(
		(key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
	);
	if (changedKeys.length === 0) return;

	if (changedKeys.includes("name") || changedKeys.includes("licencePlate")) {
		await context.tx
			.update(organizationVehicle)
			.set({
				name: change.name,
				licencePlate: change.licencePlate,
				updatedAt: sql`now()`,
				updatedBy: context.actorUserId,
			})
			.where(
				and(
					eq(organizationVehicle.organizationId, context.organizationId),
					eq(organizationVehicle.id, row.id),
				),
			);
	}
	if (changedKeys.includes("drivers")) await replaceDrivers(context, row.id, drivers);

	const pick = (source: typeof after) =>
		Object.fromEntries(changedKeys.map((key) => [key, source[key]]));
	await writeAudit(context, row.id, AuditAction.VEHICLE_UPDATED, {
		before: pick(before),
		after: pick(after),
	});
}

async function setArchived(context: ChangeContext, vehicleId: string, archived: boolean) {
	const row = await loadVehicle(context, vehicleId);
	if ((row.archivedAt !== null) === archived) return;
	await context.tx
		.update(organizationVehicle)
		.set({
			archivedAt: archived ? sql`now()` : null,
			updatedAt: sql`now()`,
			updatedBy: context.actorUserId,
		})
		.where(
			and(
				eq(organizationVehicle.organizationId, context.organizationId),
				eq(organizationVehicle.id, row.id),
			),
		);
	await writeAudit(
		context,
		row.id,
		archived ? AuditAction.VEHICLE_ARCHIVED : AuditAction.VEHICLE_RESTORED,
		{
			before: { archived: !archived },
			after: { archived },
			name: row.name,
			licencePlate: row.licencePlate,
		},
	);
}

/**
 * Whether an open time correction requests the vehicle (#1120): its requested
 * vehicle use lives in the pending request's JSON, which no foreign key guards,
 * so deleting the vehicle would make the approval fail with `vehicle_not_found`.
 */
async function requestedByOpenCorrection(context: ChangeContext, vehicleId: string) {
	const mentioned = `%${vehicleId}%`;
	const [legacy] = await context.tx
		.select({ id: approvalRequest.id })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, context.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.status, "pending"),
				sql`${approvalRequest.metadata}::text like ${mentioned}`,
			),
		)
		.limit(1);
	if (legacy) return true;
	const [canonical] = await context.tx
		.select({ id: approvalWorkflow.id })
		.from(approvalWorkflow)
		.where(
			and(
				eq(approvalWorkflow.organizationId, context.organizationId),
				eq(approvalWorkflow.workflowType, "time_correction"),
				eq(approvalWorkflow.status, "pending"),
				sql`${approvalWorkflow.contextSnapshot}::text like ${mentioned}`,
			),
		)
		.limit(1);
	return canonical !== undefined;
}

/**
 * Deletes a vehicle with its assigned drivers. A vehicle recorded on work is
 * referenced without a cascade, so PostgreSQL refuses the delete and the change
 * comes back as `vehicle_used`; so does a vehicle an open time correction
 * requests, which approving it would otherwise need.
 */
async function remove(context: ChangeContext, vehicleId: string) {
	const row = await loadVehicle(context, vehicleId);
	if (await requestedByOpenCorrection(context, row.id)) refuse("vehicle_used");
	const drivers = await currentDrivers(context, row.id);
	await context.tx
		.delete(organizationVehicle)
		.where(
			and(
				eq(organizationVehicle.organizationId, context.organizationId),
				eq(organizationVehicle.id, row.id),
			),
		);
	await writeAudit(context, row.id, AuditAction.VEHICLE_DELETED, {
		before: {
			name: row.name,
			licencePlate: row.licencePlate,
			archived: row.archivedAt !== null,
			drivers,
		},
	});
}

async function applyChange(context: ChangeContext, change: VehicleChange) {
	switch (change.kind) {
		case "create":
			return create(context, change);
		case "update":
			return update(context, change);
		case "archive":
			return setArchived(context, change.vehicleId, true);
		case "restore":
			return setArchived(context, change.vehicleId, false);
		case "delete":
			return remove(context, change.vehicleId);
	}
}

/** The PostgreSQL error code and constraint of a database error, or of one it wraps. */
function databaseError(error: unknown): { code: string; constraint?: string } | null {
	let candidate: unknown = error;
	for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
		const current = candidate as { code?: unknown; constraint?: unknown; cause?: unknown };
		if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) {
			return {
				code: current.code,
				constraint: typeof current.constraint === "string" ? current.constraint : undefined,
			};
		}
		candidate = current.cause;
	}
	return null;
}

function refusalOfDatabaseError(error: unknown, change: VehicleChange): VehicleRefusal | null {
	if (isConstraintViolation(error, "23505", "organization_vehicle_licence_plate_key_idx")) {
		return "licence_plate_taken";
	}
	const failure = databaseError(error);
	if (failure?.code !== "23503") return null;
	// A driver deleted meanwhile, or (for a delete) any table that records the vehicle:
	// each references it without a cascade, so a new one refuses without being listed here.
	if (failure.constraint?.startsWith("organization_vehicle_driver_")) return "driver_not_found";
	return change.kind === "delete" ? "vehicle_used" : null;
}

/**
 * Applies one org admin's change to the vehicles of an organization (#1118):
 * create, edit (name, licence plate, assigned drivers), archive, restore, and
 * delete a vehicle never recorded on work. Every write is audited in the same
 * transaction.
 *
 * The caller authorizes the actor as an org admin of `organizationId` first.
 * Returns every vehicle of the organization after the change.
 */
export async function changeOrganizationVehicles(
	database: Database,
	input: { organizationId: string; actorUserId: string; change: unknown },
): Promise<VehicleChangeOutcome> {
	const parsed = parseVehicleChange(input.change);
	if (!parsed.ok) return parsed;

	try {
		return await database.transaction(async (tx) => {
			await applyChange(
				{ tx, organizationId: input.organizationId, actorUserId: input.actorUserId },
				parsed.change,
			);
			return { ok: true, vehicles: await listOrganizationVehicles(tx, input.organizationId) };
		});
	} catch (error) {
		// A refusal rolls the whole change back.
		if (error instanceof Refused) return { ok: false, reason: error.reason };
		const reason = refusalOfDatabaseError(error, parsed.change);
		if (reason) return { ok: false, reason };
		throw error;
	}
}
