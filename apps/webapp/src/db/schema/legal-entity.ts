import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

import { organization, user } from "../auth-schema";
import { employee } from "./organization";

export const legalEntity = pgTable(
	"legal_entity",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		name: text("name").notNull(),
		legalName: text("legal_name"),
		registrationNumber: text("registration_number"),
		taxId: text("tax_id"),

		countryCode: text("country_code"),
		street: text("street"),
		city: text("city"),
		postalCode: text("postal_code"),
		country: text("country"),

		defaultCurrency: text("default_currency").default("EUR").notNull(),
		timezone: text("timezone").default("Europe/Berlin").notNull(),

		isDefault: boolean("is_default").default(false).notNull(),
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("legalEntity_organizationId_idx").on(table.organizationId),
		index("legalEntity_isActive_idx").on(table.isActive),
		uniqueIndex("legalEntity_org_name_idx").on(table.organizationId, table.name),
		uniqueIndex("legalEntity_org_default_active_idx")
			.on(table.organizationId)
			.where(sql`is_default = true AND is_active = true`),
	],
);

export const legalEntityAdmin = pgTable(
	"legal_entity_admin",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		legalEntityId: uuid("legal_entity_id")
			.notNull()
			.references(() => legalEntity.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
	},
	(table) => [
		index("legalEntityAdmin_organizationId_idx").on(table.organizationId),
		index("legalEntityAdmin_legalEntityId_idx").on(table.legalEntityId),
		uniqueIndex("legalEntityAdmin_entity_employee_idx").on(
			table.legalEntityId,
			table.employeeId,
		),
	],
);
