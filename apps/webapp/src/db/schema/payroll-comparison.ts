import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type { ReviewedPayrollComparison } from "@/lib/payroll-export/comparison-types";
import { organization } from "../auth-schema";
/** A short-lived immutable reviewed result, never rebuilt from live source data. */
export const payrollComparisonResult = pgTable(
	"payroll_comparison_result",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		baselineId: uuid("baseline_id").notNull(),
		digest: text("digest").notNull(),
		result: jsonb("result").$type<ReviewedPayrollComparison>().notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		index("payroll_comparison_result_org_idx").on(t.organizationId),
		index("payroll_comparison_result_expiry_idx").on(t.expiresAt),
	],
);
