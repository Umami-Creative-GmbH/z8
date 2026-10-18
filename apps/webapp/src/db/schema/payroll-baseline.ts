import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type { PayrollBaselineEvidence } from "@/lib/payroll-export/baseline-types";
import { organization } from "../auth-schema";
import { payrollExportJob } from "./payroll-export";

/** Retained independently of the job/configuration/requester; organization erasure still cascades. */
export const payrollExportBaseline = pgTable(
	"payroll_export_baseline",
	{
		id: uuid("id").primaryKey(),
		jobId: uuid("job_id").notNull(),
		descriptor: jsonb("descriptor")
			.$type<{
				formatId?: import("@/lib/payroll-export/supported-format").SupportedPayrollFormatId;
				destination: import("@/lib/payroll-export/baseline-types").PayrollBaselineDestination;
				period: { startDate: string; endDate: string };
			}>()
			.notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		version: integer("version").notNull(),
		digest: text("digest").notNull(),
		scopeEmployeeIds: jsonb("scope_employee_ids").$type<string[]>().notNull(),
		evidence: jsonb("evidence").$type<PayrollBaselineEvidence | null>(),
		unavailableReason: text("unavailable_reason").$type<
			"expired" | "erased" | null
		>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		index("payroll_export_baseline_org_completion_idx").on(
			t.organizationId,
			t.completedAt,
		),
		index("payroll_export_baseline_expiry_idx").on(t.expiresAt),
	],
);

/** Frozen employee windows of collected work, captured in the same collection snapshot. */
export const payrollExportBaselineWindowInput = pgTable(
	"payroll_export_baseline_window_input",
	{
		jobId: uuid("job_id")
			.primaryKey()
			.references(() => payrollExportJob.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		digest: text("digest").notNull(),
		windows: jsonb("windows")
			.$type<PayrollBaselineEvidence["employeeWindows"]>()
			.notNull(),
	},
);

/** No employee facts: stops existing queued/replayed jobs from resurrecting erased comparison evidence. */
export const payrollExportComparisonErasure = pgTable(
	"payroll_export_comparison_erasure",
	{
		jobId: uuid("job_id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
	},
	(t) => [
		index("payroll_export_comparison_erasure_org_idx").on(t.organizationId),
	],
);
