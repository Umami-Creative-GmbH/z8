"use server";

import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { AuthorizationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	formerSinceDate,
	isFormerEmployee,
	onCurrentRoster,
} from "@/lib/employee-lifecycle/current-roster";
import { formerSinceField } from "@/lib/employee-lifecycle/former-since";
import type { VehicleChangeInput } from "@/lib/organization/vehicles/vehicle-rules";
import {
	changeOrganizationVehicles,
	listOrganizationVehicles,
	type OrganizationVehicleView,
	type VehicleChangeOutcome,
} from "@/lib/organization/vehicles/vehicles";

const ADMIN_ONLY = "Only owners and admins can manage vehicles";

export interface VehicleDriverOption {
	id: string;
	name: string;
	email: string;
	/** Departed employees can't be newly assigned but stay shown where they are. */
	isActive: boolean;
	/** A former employee (#1438): offered only where a vehicle already has them. */
	isFormer: boolean;
	/**
	 * On a former employee only: the organization-local date they left
	 * (`YYYY-MM-DD`, #1439), null when the date isn't recorded.
	 */
	formerSince?: string | null;
}

export interface VehicleSettingsData {
	vehicles: OrganizationVehicleView[];
	employees: VehicleDriverOption[];
	teams: Array<{ id: string; name: string }>;
}

/** The session's active organization, with the actor an owner or admin of it. */
const vehiclesActor = (action: string) =>
	Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Select an organization first",
					userId: session.user.id,
					resource: "vehicle",
					action,
				}),
			);
		}
		yield* requireActiveOrganizationActionActor({
			userId: session.user.id,
			organizationId,
			requiredRole: "admin",
			message: ADMIN_ONLY,
			resource: "vehicle",
			action,
		});
		return { organizationId, userId: session.user.id };
	});

/**
 * The vehicles of the active organization, active and archived, with the
 * employees and teams that can be assigned drivers. Org admins only.
 */
export async function getVehicleSettings(): Promise<ServerActionResult<VehicleSettingsData>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* vehiclesActor("read");
			const dbService = yield* DatabaseService;
			return yield* dbService.query("vehicles.settings", async () => {
				const [vehicles, teams] = await Promise.all([
					listOrganizationVehicles(dbService.db, actor.organizationId),
					dbService.db
						.select({ id: team.id, name: team.name })
						.from(team)
						.where(eq(team.organizationId, actor.organizationId))
						.orderBy(asc(team.name), asc(team.id)),
				]);
				// The current roster (#1438), plus former employees a vehicle still has
				// as drivers, marked, so editing that vehicle keeps them.
				const assignedIds = [
					...new Set(
						vehicles.flatMap((vehicle) => vehicle.drivers.employees.map((driver) => driver.id)),
					),
				];
				const people = await dbService.db
					.select({
						id: employee.id,
						employeeNumber: employee.employeeNumber,
						isFormer: isFormerEmployee(employee),
						formerSince: formerSinceDate(employee),
						name: user.name,
						email: user.email,
					})
					.from(employee)
					.innerJoin(user, eq(user.id, employee.userId))
					.where(
						and(
							eq(employee.organizationId, actor.organizationId),
							assignedIds.length > 0
								? or(onCurrentRoster(actor.organizationId), inArray(employee.id, assignedIds))
								: onCurrentRoster(actor.organizationId),
						),
					)
					.orderBy(asc(user.name), asc(employee.id));
				return {
					vehicles,
					employees: people.map((row) => ({
						id: row.id,
						name: row.name?.trim() || row.employeeNumber || row.id,
						email: row.email,
						isActive: !row.isFormer,
						isFormer: row.isFormer,
						...formerSinceField(row.isFormer, row.formerSince),
					})),
					teams,
				};
			});
		}),
	);
}

/**
 * Applies one change to the vehicles of the active organization. Org admins
 * only. A refused change comes back as `{ ok: false, reason }`; an accepted one
 * returns every vehicle of the organization.
 */
export async function changeVehicles(
	change: VehicleChangeInput,
): Promise<ServerActionResult<VehicleChangeOutcome>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* vehiclesActor("change");
			const dbService = yield* DatabaseService;
			const outcome = yield* dbService.query("vehicles.change", () =>
				changeOrganizationVehicles(dbService.db, {
					organizationId: actor.organizationId,
					actorUserId: actor.userId,
					change,
				}),
			);
			if (outcome.ok) revalidatePath("/settings/vehicles");
			return outcome;
		}),
	);
}
