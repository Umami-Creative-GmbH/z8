import { type SQL, sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee, team } from "./organization";

/**
 * Organization vehicles (#1118, spec #807): vehicles the organization provides
 * for its employees to drive for work. See the Organization glossary
 * (`src/lib/organization/CONTEXT.md`, "Vehicles"); the store is
 * `src/lib/organization/vehicles/vehicles.ts`.
 *
 * - `licence_plate` is stored upper-cased with single spaces. Plates are unique
 *   per organization by `licence_plate_key` (no spaces, hyphens or dots), for
 *   archived vehicles too, so a restore or a plate lookup never meets two.
 * - An archived vehicle (`archived_at`) can no longer be picked but stays on the
 *   work it was recorded on.
 * - A vehicle is deleted only while it was never recorded on work. Every table
 *   that records vehicle use references `(id, organization_id)` without a
 *   cascade, so the delete is refused by the database (`vehicle_used`).
 */
export const organizationVehicle = pgTable(
	"organization_vehicle",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		licencePlate: text("licence_plate").notNull(),
		licencePlateKey: text("licence_plate_key")
			.notNull()
			.generatedAlwaysAs(
				(): SQL =>
					sql`regexp_replace(upper(${organizationVehicle.licencePlate}), '[[:space:].-]', '', 'g')`,
			),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		unique("organization_vehicle_id_organization_id_unique").on(table.id, table.organizationId),
		uniqueIndex("organization_vehicle_licence_plate_key_idx").on(
			table.organizationId,
			table.licencePlateKey,
		),
		check("organization_vehicle_name_check", sql`length(btrim(${table.name})) BETWEEN 1 AND 100`),
		check(
			"organization_vehicle_licence_plate_check",
			sql`length(${table.licencePlate}) BETWEEN 1 AND 20 AND length(${table.licencePlateKey}) >= 1`,
		),
	],
);

/**
 * Assigned drivers: an employee, or every member of a team, for whom a vehicle
 * is the one usually driven, so it is suggested first. Exactly one of
 * `employee_id` / `team_id`; both of the vehicle's organization.
 */
export const organizationVehicleDriver = pgTable(
	"organization_vehicle_driver",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		vehicleId: uuid("vehicle_id").notNull(),
		employeeId: uuid("employee_id"),
		teamId: uuid("team_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		foreignKey({
			name: "organization_vehicle_driver_vehicle_fk",
			columns: [table.vehicleId, table.organizationId],
			foreignColumns: [organizationVehicle.id, organizationVehicle.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "organization_vehicle_driver_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "organization_vehicle_driver_team_fk",
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
		check(
			"organization_vehicle_driver_target_check",
			sql`(${table.employeeId} IS NULL) <> (${table.teamId} IS NULL)`,
		),
		uniqueIndex("organization_vehicle_driver_employee_idx")
			.on(table.vehicleId, table.employeeId)
			.where(sql`employee_id IS NOT NULL`),
		uniqueIndex("organization_vehicle_driver_team_idx")
			.on(table.vehicleId, table.teamId)
			.where(sql`team_id IS NOT NULL`),
		index("organization_vehicle_driver_organization_employee_idx").on(
			table.organizationId,
			table.employeeId,
		),
		index("organization_vehicle_driver_organization_team_idx").on(
			table.organizationId,
			table.teamId,
		),
	],
);
