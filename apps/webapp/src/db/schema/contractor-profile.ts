import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

/*
 * Not re-exported from the schema barrel (`./index.ts`): one more table in the
 * relational `db.query` type pushed `WorkBalanceDbClient` transactions past
 * TypeScript's instantiation depth (TS2589). Import it from this module;
 * drizzle.config.ts lists it for `db:push`.
 */

/**
 * Optional contracting details of an External Contractor (#1995, spec #1935),
 * organization-scoped and kept apart from the employee profile and custom
 * fields: the contracting company, its VAT ID and a PO or cost-center
 * reference. Informational; Z8 never issues invoices.
 */
export const employeeContractorProfile = pgTable(
	"employee_contractor_profile",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		companyName: text("company_name"),
		vatId: text("vat_id"),
		/** PO number or cost-center reference finance matches invoices against. */
		referenceCode: text("reference_code"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		unique("employeeContractorProfile_org_employee_unique").on(
			table.organizationId,
			table.employeeId,
		),
		foreignKey({
			name: "employeeContractorProfile_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"employeeContractorProfile_company_name_check",
			sql`${table.companyName} IS NULL OR char_length(${table.companyName}) <= 200`,
		),
		check(
			"employeeContractorProfile_vat_id_check",
			sql`${table.vatId} IS NULL OR char_length(${table.vatId}) <= 50`,
		),
		check(
			"employeeContractorProfile_reference_code_check",
			sql`${table.referenceCode} IS NULL OR char_length(${table.referenceCode}) <= 100`,
		),
	],
);

export type EmployeeContractorProfile = typeof employeeContractorProfile.$inferSelect;
