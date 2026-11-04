import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { db as database } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { equipmentCommand, equipmentOfficerGrant } from "@/db/schema/equipment";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { AuthorizationError } from "@/lib/effect/errors";
import {
	employeeHasOrganizationAccess,
	resolveEmployeeOrganizationAccess,
} from "@/lib/employee-lifecycle/access";
import {
	type EquipmentActor,
	equipmentAccess,
	lockEquipmentContext,
} from "./access";
import {
	type EquipmentOfficerView,
	type EquipmentOutcome,
	equipmentOfficerChangeSchema,
} from "./contracts";

export async function readEquipmentOfficers(
	db: typeof database,
	actor: EquipmentActor,
): Promise<EquipmentOfficerView> {
	return db.transaction(async (tx) => {
		await lockEquipmentContext(tx, actor);
		const access = await equipmentAccess(tx, actor);
		if (!access.canAdminister)
			throw new AuthorizationError({
				message: "Equipment officer administration is not available.",
				resource: "equipment",
				action: "manage",
			});
		const [employees, teams, grants] = await Promise.all([
			tx
				.select({
					id: employee.id,
					name: user.name,
					current: sql<boolean>`(${employeeHasOrganizationAccess(systemClock.nowInstant())} and exists (select 1 from member m where m.organization_id = ${employee.organizationId} and m.user_id = ${employee.userId} and m.status = 'approved'))`,
				})
				.from(employee)
				.innerJoin(user, eq(user.id, employee.userId))
				.where(eq(employee.organizationId, actor.organizationId))
				.orderBy(asc(user.name)),
			tx
				.select({ id: team.id, name: team.name })
				.from(team)
				.where(eq(team.organizationId, actor.organizationId))
				.orderBy(asc(team.name)),
			tx
				.select()
				.from(equipmentOfficerGrant)
				.where(eq(equipmentOfficerGrant.organizationId, actor.organizationId)),
		]);
		const employeeMap = new Map(employees.map((e) => [e.id, e]));
		return {
			employees,
			teams,
			grants: grants.map((g) => ({
				employeeId: g.employeeId,
				name: employeeMap.get(g.employeeId)?.name ?? "",
				current: employeeMap.get(g.employeeId)?.current ?? false,
				scope: g.scope,
				teamIds: g.teamIds,
				employeeIds: g.employeeIds,
				revoked: !!g.revokedAt,
				revision: g.revision,
			})),
		};
	});
}

export async function applyEquipmentOfficerChange(
	db: typeof database,
	actor: EquipmentActor,
	input: unknown,
): Promise<EquipmentOutcome> {
	const parsed = equipmentOfficerChangeSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid_input" };
	const change = parsed.data;
	const fingerprint = createHash("sha256")
		.update(JSON.stringify({ actor: actor.userId, change }))
		.digest("hex");
	return db.transaction(async (tx) => {
		const [target] = await tx
			.select({ id: employee.id, userId: employee.userId })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					eq(employee.id, change.employeeId),
				),
			);
		await lockEquipmentContext(tx, actor, target);
		const access = await equipmentAccess(tx, actor);
		if (!access.canAdminister) return { ok: false, reason: "forbidden" };
		if (!target) return { ok: false, reason: "not_found" };
		const where = and(
			eq(equipmentOfficerGrant.organizationId, actor.organizationId),
			eq(equipmentOfficerGrant.employeeId, change.employeeId),
		);
		const [replay] = await tx
			.select()
			.from(equipmentCommand)
			.where(
				and(
					eq(equipmentCommand.organizationId, actor.organizationId),
					eq(equipmentCommand.requestId, change.requestId),
				),
			);
		if (replay)
			return replay.fingerprint === fingerprint
				? replay.result
				: { ok: false, reason: "request_conflict" };
		const [existing] = await tx
			.select()
			.from(equipmentOfficerGrant)
			.where(where);
		if ((existing?.revision ?? 0) !== change.expectedRevision)
			return { ok: false, reason: "stale_revision" };
		const now = systemClock.nowInstant();
		if (change.kind === "set_officer_grant") {
			const holderAccess = await resolveEmployeeOrganizationAccess(tx, {
				organizationId: actor.organizationId,
				userId: target.userId,
				now,
			});
			if (!holderAccess.allowed || holderAccess.employeeId !== target.id)
				return { ok: false, reason: "employee_not_current" };
			if (
				(change.scope === "all" &&
					(change.teamIds.length || change.employeeIds.length)) ||
				(change.scope === "selected" &&
					!change.teamIds.length &&
					!change.employeeIds.length)
			)
				return { ok: false, reason: "invalid_input" };
			const teamIds = [...new Set(change.teamIds)];
			const employeeIds = [...new Set(change.employeeIds)];
			const teams = teamIds.length
				? await tx
						.select({ id: team.id })
						.from(team)
						.where(
							and(
								eq(team.organizationId, actor.organizationId),
								inArray(team.id, teamIds),
							),
						)
				: [];
			const subjects = employeeIds.length
				? await tx
						.select({ id: employee.id })
						.from(employee)
						.where(
							and(
								eq(employee.organizationId, actor.organizationId),
								inArray(employee.id, employeeIds),
							),
						)
				: [];
			if (
				teams.length !== teamIds.length ||
				subjects.length !== employeeIds.length
			)
				return { ok: false, reason: "not_found" };
			const values = {
				organizationId: actor.organizationId,
				employeeId: target.id,
				scope: change.scope,
				teamIds,
				employeeIds,
				revokedAt: null,
				revision: (existing?.revision ?? 0) + 1,
				updatedAt: dateFromInstant(now),
				updatedBy: actor.userId,
			};
			await tx
				.insert(equipmentOfficerGrant)
				.values(values)
				.onConflictDoUpdate({
					target: [
						equipmentOfficerGrant.organizationId,
						equipmentOfficerGrant.employeeId,
					],
					set: values,
				});
		} else {
			if (!existing) return { ok: false, reason: "not_found" };
			await tx
				.update(equipmentOfficerGrant)
				.set({
					revokedAt: dateFromInstant(now),
					revision: existing.revision + 1,
					updatedAt: dateFromInstant(now),
					updatedBy: actor.userId,
				})
				.where(where);
		}
		const result = {
			ok: true,
			id: actor.organizationId,
			revision: (existing?.revision ?? 0) + 1,
		} as const;
		await tx.insert(equipmentCommand).values({
			organizationId: actor.organizationId,
			requestId: change.requestId,
			fingerprint,
			result,
		});
		return result;
	});
}
