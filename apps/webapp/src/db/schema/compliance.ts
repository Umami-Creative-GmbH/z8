import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { complianceExceptionStatusEnum, complianceExceptionTypeEnum } from "./enums";
import { employee } from "./organization";
import { workPeriod } from "./time-tracking";

// ============================================
// COMPLIANCE EXCEPTIONS (Pre-approval & Post-hoc)
// ============================================

/**
 * Tracks requests for compliance exceptions (pre-approval for overtime/rest period violations)
 * and post-hoc acknowledgments of violations that occurred.
 *
 * Pre-approval: Employee requests exception in advance (expires after 24h)
 * Post-hoc: Violation occurred, manager acknowledges after the fact
 */
export const complianceException = pgTable(
	"compliance_exception",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Organization scoping - CRITICAL for multi-tenancy
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Employee requesting the exception
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),

		// Type of exception being requested
		exceptionType: complianceExceptionTypeEnum("exception_type").notNull(),

		// Current status
		status: complianceExceptionStatusEnum("status").default("pending").notNull(),

		// Request details
		reason: text("reason").notNull(), // Why the exception is needed
		plannedDurationMinutes: integer("planned_duration_minutes"), // For overtime: how long planned

		// Pre-approval: What date this exception is for (24h validity window)
		validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
		validUntil: timestamp("valid_until", { withTimezone: true }).notNull(), // validFrom + 24h

		// Manager approval
		approverId: uuid("approver_id").references(() => employee.id),
		approvedAt: timestamp("approved_at", { withTimezone: true }),
		rejectedAt: timestamp("rejected_at", { withTimezone: true }),
		rejectionReason: text("rejection_reason"),

		// Usage tracking
		wasUsed: boolean("was_used").default(false).notNull(), // Was this exception actually used?
		usedAt: timestamp("used_at", { withTimezone: true }), // When the exception was used
		actualDurationMinutes: integer("actual_duration_minutes"), // Actual overtime worked

		// Link to work period if this exception was used during clock-in
		workPeriodId: uuid("work_period_id").references(() => workPeriod.id, {
			onDelete: "set null",
		}),

		// Audit fields
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("complianceException_organizationId_idx").on(table.organizationId),
		index("complianceException_employeeId_idx").on(table.employeeId),
		index("complianceException_status_idx").on(table.status),
		index("complianceException_exceptionType_idx").on(table.exceptionType),
		index("complianceException_validFrom_idx").on(table.validFrom),
		index("complianceException_validUntil_idx").on(table.validUntil),
		// Composite index for finding valid exceptions
		index("complianceException_emp_status_validUntil_idx").on(
			table.employeeId,
			table.status,
			table.validUntil,
		),
		// Composite index for manager approvals
		index("complianceException_org_status_idx").on(table.organizationId, table.status),
	],
);
