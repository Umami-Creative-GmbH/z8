import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { DeclaredLicenceClass } from "@/lib/organization/driving-licence/check-types";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

/**
 * Declared classes (#2003): an intended driver's own statement of the licence classes they
 * hold, with the document's and each class's expiry date where there is one. It grants no
 * authorization; a verifier's check replaces the classes it inspects. One row per employee,
 * removed once the employee is no longer an intended driver or leaves.
 *
 * Writes serialize on the driving licence organization lock.
 */
export const drivingLicenceDeclaredClasses = pgTable(
	"driving_licence_declared_classes",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		classes: jsonb("classes").$type<DeclaredLicenceClass[]>().notNull(),
		documentExpiresOn: date("document_expires_on"),
		/** Raised on every save: each new statement notifies the responsible verifiers once. */
		version: integer("version").default(1).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		unique("driving_declared_classes_employee").on(t.organizationId, t.employeeId),
		foreignKey({
			name: "driving_declared_classes_employee_fk",
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"driving_declared_classes_list",
			sql`jsonb_typeof(${t.classes})='array' AND jsonb_array_length(${t.classes}) > 0`,
		),
	],
);
