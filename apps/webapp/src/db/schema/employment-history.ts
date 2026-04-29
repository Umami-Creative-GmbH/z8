import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

import { organization, user } from "../auth-schema";
import {
	contractTypeEnum,
	employmentReviewStateEnum,
	employmentStatusEnum,
	workModelEnum,
} from "./enums";
import { employee } from "./organization";
import { workPolicy } from "./work-policy";

export const employeeEmploymentHistory = pgTable(
	"employee_employment_history",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		validFrom: timestamp("valid_from").notNull(),
		validUntil: timestamp("valid_until"),
		status: employmentStatusEnum("status").default("active").notNull(),
		contractType: contractTypeEnum("contract_type").default("fixed").notNull(),
		weeklyContractMinutes: integer("weekly_contract_minutes").notNull(),
		probationStartsOn: timestamp("probation_starts_on", { mode: "date" }),
		probationEndsOn: timestamp("probation_ends_on", { mode: "date" }),
		workModel: workModelEnum("work_model").default("onsite").notNull(),
		workPolicyId: uuid("work_policy_id").references(() => workPolicy.id, { onDelete: "set null" }),
		hourlyRate: text("hourly_rate"),
		currency: text("currency").default("EUR").notNull(),
		changeReason: text("change_reason"),
		reviewState: employmentReviewStateEnum("review_state").default("draft").notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("employeeEmploymentHistory_employeeId_idx").on(table.employeeId),
		index("employeeEmploymentHistory_organizationId_idx").on(table.organizationId),
		index("employeeEmploymentHistory_employee_validFrom_idx").on(table.employeeId, table.validFrom),
		index("employeeEmploymentHistory_employee_reviewState_idx").on(
			table.employeeId,
			table.reviewState,
		),
		index("employeeEmploymentHistory_workPolicyId_idx").on(table.workPolicyId),
	],
);

export type EmployeeEmploymentHistory = typeof employeeEmploymentHistory.$inferSelect;
export type NewEmployeeEmploymentHistory = typeof employeeEmploymentHistory.$inferInsert;
