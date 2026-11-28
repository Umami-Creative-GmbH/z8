import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	decimal,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

/** How an external leave notice reached the employee. */
export type ExternalLeaveNoticeDeliveryMethod = "in_person" | "letter" | "email" | "other";

/**
 * An external leave notice (#2082, spec #2057): HR's dated attestation that the employee was given
 * a notice outside Z8 that asked them to take `days` of leave year `leaveYear` by `deadline` and
 * warned that unused days could lapse. Final; migration 0347 refuses updates.
 */
export const vacationExternalLeaveNotice = pgTable(
	"vacation_external_leave_notice",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		leaveYear: integer("leave_year").notNull(),
		/** The days the notice asked the employee to take; the most it can ever cover. */
		days: decimal("days").notNull(),
		/** Organization-local date the notice was given. */
		deliveredOn: date("delivered_on").notNull(),
		deliveryMethod: text("delivery_method").$type<ExternalLeaveNoticeDeliveryMethod>().notNull(),
		/** How exactly it was given; required for `other`. */
		deliveryDetails: text("delivery_details"),
		/** The deadline the notice stated: its last valid instant in `timezone`. */
		deadline: timestamp("deadline", { withTimezone: true }).notNull(),
		timezone: text("timezone").notNull(),
		/** HR confirms the notice asked the employee to take the days. Always true. */
		requestedToTakeLeave: boolean("requested_to_take_leave").notNull(),
		/** HR confirms the notice warned that unused days could lapse. Always true. */
		warnedOfLapse: boolean("warned_of_lapse").notNull(),
		/** Optional: where supporting documents, such as the signed notice, are kept. */
		supportingDocuments: text("supporting_documents"),
		attestedBy: text("attested_by").references(() => user.id, { onDelete: "set null" }),
		attestedAt: timestamp("attested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("vacation_external_leave_notice_org_id_idx").on(table.id, table.organizationId),
		index("vacation_external_leave_notice_employee_idx").on(
			table.organizationId,
			table.employeeId,
			table.leaveYear,
		),
		foreignKey({
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check("vacation_external_leave_notice_days_check", sql`${table.days} > 0`),
		check(
			"vacation_external_leave_notice_method_check",
			sql`${table.deliveryMethod} IN ('in_person','letter','email','other')`,
		),
		check(
			"vacation_external_leave_notice_details_check",
			sql`${table.deliveryMethod} <> 'other' OR length(btrim(coalesce(${table.deliveryDetails}, ''))) > 0`,
		),
		check(
			"vacation_external_leave_notice_year_check",
			sql`${table.leaveYear} <= extract(year FROM ${table.deliveredOn})`,
		),
	],
);

/**
 * HR's documented finding that the employee had a real opportunity to take the days a leave notice
 * covers before its deadline (#2082). One per notice; final.
 */
export const vacationLeaveOpportunityAssessment = pgTable(
	"vacation_leave_opportunity_assessment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		externalNoticeId: uuid("external_notice_id").notNull(),
		basis: text("basis").notNull(),
		assessedBy: text("assessed_by").references(() => user.id, { onDelete: "set null" }),
		assessedAt: timestamp("assessed_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("vacation_leave_opportunity_assessment_notice_idx").on(table.externalNoticeId),
		foreignKey({
			columns: [table.externalNoticeId, table.organizationId],
			foreignColumns: [vacationExternalLeaveNotice.id, vacationExternalLeaveNotice.organizationId],
		}).onDelete("cascade"),
		check(
			"vacation_leave_opportunity_assessment_basis_check",
			sql`length(btrim(${table.basis})) > 0`,
		),
	],
);
