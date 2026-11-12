"use server";

import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { ValidationError } from "@/lib/effect/errors";
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
} from "@/lib/organization/vehicles/vehicles";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

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

/**
 * The vehicles of the active organization, active and archived, with the
 * employees and teams that can be assigned drivers. Org admins only.
 */
export const getVehicleSettings = organizationAction(
	{ name: "vehicles.settings", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("vehicles.settings", async (): Promise<VehicleSettingsData> => {
				const [vehicles, teams] = await Promise.all([
					listOrganizationVehicles(dbService.db, organizationId),
					dbService.db
						.select({ id: team.id, name: team.name })
						.from(team)
						.where(eq(team.organizationId, organizationId))
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
							eq(employee.organizationId, organizationId),
							assignedIds.length > 0
								? or(onCurrentRoster(organizationId), inArray(employee.id, assignedIds))
								: onCurrentRoster(organizationId),
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

/**
 * A vehicle change as the client sends it. `parseVehicleChange` reads it inside
 * `changeOrganizationVehicles`, so a malformed change keeps its own refusal
 * code, which the form maps.
 */
const vehicleChangeSchema = z.custom<VehicleChangeInput>(
	(value) => typeof value === "object" && value !== null,
	{ error: "Choose a valid vehicle change" },
);

/**
 * Applies one change to the vehicles of the active organization and returns
 * every vehicle of the organization. Org admins only. A refused change fails
 * with a `ValidationError` whose `refusal` is the store's reason.
 */
export const changeVehicles = organizationAction(
	// No `addsEmployees`: the store refuses only newly assigned former drivers
	// (`former_driver`) and keeps the ones a vehicle already has (#1438).
	{ name: "vehicles.change", requires: "orgAdmin", schema: vehicleChangeSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const outcome = yield* dbService.query("vehicles.change", () =>
				changeOrganizationVehicles(dbService.db, {
					organizationId,
					actorUserId: actor.userId,
					change: input,
				}),
			);
			if (!outcome.ok) {
				return yield* Effect.fail(
					new ValidationError({
						message: "The vehicle change was refused",
						refusal: outcome.reason,
					}),
				);
			}
			revalidatePath("/settings/vehicles");
			return outcome.vehicles;
		}),
);
