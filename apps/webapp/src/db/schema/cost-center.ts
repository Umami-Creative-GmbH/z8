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

import { organization } from "../auth-schema";
import { employee } from "./organization";

export const costCenter = pgTable(
	"cost_center",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		code: text("code"),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("costCenter_organizationId_idx").on(table.organizationId),
		index("costCenter_isActive_idx").on(table.isActive),
		uniqueIndex("costCenter_org_name_idx").on(table.organizationId, table.name),
		uniqueIndex("costCenter_org_code_idx")
			.on(table.organizationId, table.code)
			.where(sql`code IS NOT NULL`),
	],
);

export const employeeCostCenterAssignment = pgTable(
	"employee_cost_center_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		costCenterId: uuid("cost_center_id")
			.notNull()
			.references(() => costCenter.id, { onDelete: "cascade" }),
		effectiveFrom: timestamp("effective_from").notNull(),
		effectiveTo: timestamp("effective_to"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("employeeCostCenterAssignment_organizationId_idx").on(table.organizationId),
		index("employeeCostCenterAssignment_employeeId_idx").on(table.employeeId),
		index("employeeCostCenterAssignment_costCenterId_idx").on(table.costCenterId),
		index("employeeCostCenterAssignment_effectiveFrom_idx").on(table.effectiveFrom),
		uniqueIndex("employeeCostCenterAssignment_active_employee_idx")
			.on(table.employeeId)
			.where(sql`effective_to IS NULL`),
	],
);
