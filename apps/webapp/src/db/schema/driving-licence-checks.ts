import { sql } from "drizzle-orm";
import {
	boolean,
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
import type { DrivingCheckClass } from "@/lib/organization/driving-licence/check-types";
import { organization, user } from "../auth-schema";
import { employeeEmploymentPeriod } from "./employee-lifecycle";
import { employee } from "./organization";
export const drivingLicenceCheck = pgTable(
	"driving_licence_check",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id"),
		verifierEmployeeId: uuid("verifier_employee_id").notNull(),
		verifierUserId: text("verifier_user_id")
			.notNull()
			.references(() => user.id),
		employeeName: text("employee_name").notNull(),
		verifierName: text("verifier_name").notNull(),
		controlledAt: timestamp("controlled_at", { withTimezone: true }).notNull(),
		commandId: uuid("command_id").notNull(),
		policyVersion: integer("policy_version").notNull(),
		intervalMonths: integer("interval_months").notNull(),
		deadlineTimezone: text("deadline_timezone").notNull(),
		documentIssuedOn: date("document_issued_on").notNull(),
		documentExpiresOn: date("document_expires_on").notNull(),
		originalInspected: boolean("original_inspected").notNull(),
		identityConfirmed: boolean("identity_confirmed").notNull(),
		employeeDeclaration: boolean("employee_declaration").notNull(),
		declarationText: text("declaration_text").notNull(),
		verifierConfirmed: boolean("verifier_confirmed").notNull(),
		classes: jsonb("classes").$type<DrivingCheckClass[]>().notNull(),
		failureScope: text("failure_scope")
			.$type<"classes" | "document" | "person">()
			.notNull(),
	},
	(t) => [
		unique("driving_check_org_id").on(t.organizationId, t.id),
		unique("driving_check_command").on(t.organizationId, t.commandId),
		foreignKey({
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.verifierEmployeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			columns: [t.employmentPeriodId, t.organizationId, t.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}),
		check(
			"driving_check_not_self",
			sql`${t.employeeId} <> ${t.verifierEmployeeId}`,
		),
		check("driving_check_confirmation", sql`${t.verifierConfirmed}`),
		check(
			"driving_check_document_dates",
			sql`${t.documentIssuedOn} <= ${t.documentExpiresOn}`,
		),
		check(
			"driving_check_classes",
			sql`jsonb_typeof(${t.classes})='array' AND jsonb_array_length(${t.classes}) > 0`,
		),
	],
);
export const drivingAuthorization = pgTable(
	"driving_authorization",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id"),
		classCode: text("class_code").notNull(),
		supportingCheckId: uuid("supporting_check_id").notNull(),
		lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }),
		routineValidThrough: date("routine_valid_through").notNull(),
		documentValidThrough: date("document_valid_through").notNull(),
		classValidThrough: date("class_valid_through"),
		validThrough: date("valid_through").notNull(),
		deadlineTimezone: text("deadline_timezone").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		restrictions: text("restrictions").notNull(),
		state: text("state").$type<"active" | "suspended" | "ended">().notNull(),
		suspensionReason: text("suspension_reason"),
		suspendedAt: timestamp("suspended_at", { withTimezone: true }),
	},
	(t) => [
		unique("driving_authorization_subject_class").on(
			t.organizationId,
			t.employeeId,
			t.classCode,
		),
		foreignKey({
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.organizationId, t.supportingCheckId],
			foreignColumns: [
				drivingLicenceCheck.organizationId,
				drivingLicenceCheck.id,
			],
		}),
		check(
			"driving_authorization_state",
			sql`${t.state} IN ('active','suspended','ended')`,
		),
	],
);
export const drivingLicenceSubject = pgTable(
	"driving_licence_subject",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id"),
		suspensionKind: text("suspension_kind")
			.$type<"person" | "document">()
			.notNull(),
		suspendedAt: timestamp("suspended_at", { withTimezone: true }).notNull(),
		sourceCheckId: uuid("source_check_id"),
	},
	(t) => [
		unique("driving_subject_employee").on(t.organizationId, t.employeeId),
		foreignKey({
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
export const drivingAuthorizationEvent = pgTable(
	"driving_authorization_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id"),
		classCode: text("class_code"),
		checkId: uuid("check_id"),
		kind: text("kind").notNull(),
		reason: text("reason"),
		effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
		recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
		actorUserId: text("actor_user_id"),
	},
	(t) => [
		foreignKey({
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.organizationId, t.checkId],
			foreignColumns: [
				drivingLicenceCheck.organizationId,
				drivingLicenceCheck.id,
			],
		}).onDelete("cascade"),
	],
);
