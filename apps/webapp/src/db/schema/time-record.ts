import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

import { organization, user } from "../auth-schema";
import {
	dayPeriodEnum,
	timeRecordAllocationKindEnum,
	timeRecordApprovalDecisionActionEnum,
	timeRecordApprovalStateEnum,
	timeRecordKindEnum,
	timeRecordOriginEnum,
	workLocationTypeEnum,
} from "./enums";
import { absenceCategory } from "./absence";
import { costCenter } from "./cost-center";
import { employee } from "./organization";
import { project } from "./project";
import { workCategory } from "./work-category";

export const timeRecord = pgTable(
	"time_record",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		recordKind: timeRecordKindEnum("record_kind").notNull(),
		startAt: timestamp("start_at").notNull(),
		endAt: timestamp("end_at"),
		durationMinutes: integer("duration_minutes"),
		approvalState: timeRecordApprovalStateEnum("approval_state").default("draft").notNull(),
		origin: timeRecordOriginEnum("origin").default("manual").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		uniqueIndex("timeRecord_id_organizationId_idx").on(table.id, table.organizationId),
		uniqueIndex("timeRecord_id_recordKind_idx").on(table.id, table.recordKind),
		index("timeRecord_organizationId_idx").on(table.organizationId),
		index("timeRecord_employeeId_idx").on(table.employeeId),
		index("timeRecord_recordKind_idx").on(table.recordKind),
		index("timeRecord_approvalState_idx").on(table.approvalState),
		index("timeRecord_org_startAt_idx").on(table.organizationId, table.startAt),
		index("timeRecord_startAt_idx").on(table.startAt),
		index("timeRecord_employee_org_startAt_idx").on(
			table.employeeId,
			table.organizationId,
			table.startAt,
		),
		check(
			"timeRecord_durationMinutes_nonNegative_chk",
			sql`${table.durationMinutes} IS NULL OR ${table.durationMinutes} >= 0`,
		),
		check(
			"timeRecord_endAt_afterStartAt_chk",
			sql`${table.endAt} IS NULL OR ${table.endAt} >= ${table.startAt}`,
		),
	],
);

export const timeRecordWork = pgTable(
	"time_record_work",
	{
		recordId: uuid("record_id")
			.primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recordKind: timeRecordKindEnum("record_kind").default("work").notNull(),
		workCategoryId: uuid("work_category_id").references(() => workCategory.id, {
			onDelete: "set null",
		}),
		workLocationType: workLocationTypeEnum("work_location_type"),
		computationMetadata: text("computation_metadata"),
	},
	(table) => [
		uniqueIndex("timeRecordWork_record_org_idx").on(table.recordId, table.organizationId),
		index("timeRecordWork_organizationId_idx").on(table.organizationId),
		index("timeRecordWork_workCategoryId_idx").on(table.workCategoryId),
		check("timeRecordWork_recordKind_work_chk", sql`${table.recordKind} = 'work'`),
		foreignKey({
			columns: [table.recordId, table.organizationId],
			foreignColumns: [timeRecord.id, timeRecord.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.recordId, table.recordKind],
			foreignColumns: [timeRecord.id, timeRecord.recordKind],
		}).onDelete("cascade"),
	],
);

export const timeRecordAbsence = pgTable(
	"time_record_absence",
	{
		recordId: uuid("record_id")
			.primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recordKind: timeRecordKindEnum("record_kind").default("absence").notNull(),
		absenceCategoryId: uuid("absence_category_id")
			.notNull()
			.references(() => absenceCategory.id),
		startPeriod: dayPeriodEnum("start_period").default("full_day").notNull(),
		endPeriod: dayPeriodEnum("end_period").default("full_day").notNull(),
		countsAgainstVacation: boolean("counts_against_vacation").default(true).notNull(),
	},
	(table) => [
		index("timeRecordAbsence_organizationId_idx").on(table.organizationId),
		index("timeRecordAbsence_absenceCategoryId_idx").on(table.absenceCategoryId),
		check("timeRecordAbsence_recordKind_absence_chk", sql`${table.recordKind} = 'absence'`),
		foreignKey({
			columns: [table.recordId, table.organizationId],
			foreignColumns: [timeRecord.id, timeRecord.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.recordId, table.recordKind],
			foreignColumns: [timeRecord.id, timeRecord.recordKind],
		}).onDelete("cascade"),
	],
);

export const timeRecordBreak = pgTable(
	"time_record_break",
	{
		recordId: uuid("record_id")
			.primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recordKind: timeRecordKindEnum("record_kind").default("break").notNull(),
		isPaid: boolean("is_paid").default(false).notNull(),
		autoInsertReason: text("auto_insert_reason"),
	},
	(table) => [
		index("timeRecordBreak_organizationId_idx").on(table.organizationId),
		check("timeRecordBreak_recordKind_break_chk", sql`${table.recordKind} = 'break'`),
		foreignKey({
			columns: [table.recordId, table.organizationId],
			foreignColumns: [timeRecord.id, timeRecord.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.recordId, table.recordKind],
			foreignColumns: [timeRecord.id, timeRecord.recordKind],
		}).onDelete("cascade"),
	],
);

export const timeRecordAllocation = pgTable(
	"time_record_allocation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recordId: uuid("record_id")
			.notNull(),
		allocationKind: timeRecordAllocationKindEnum("allocation_kind").notNull(),
		projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
		costCenterId: uuid("cost_center_id").references(() => costCenter.id, {
			onDelete: "set null",
		}),
		weightPercent: integer("weight_percent").default(100).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("timeRecordAllocation_organizationId_idx").on(table.organizationId),
		index("timeRecordAllocation_recordId_idx").on(table.recordId),
		index("timeRecordAllocation_projectId_idx").on(table.projectId),
		index("timeRecordAllocation_costCenterId_idx").on(table.costCenterId),
		foreignKey({
			columns: [table.recordId, table.organizationId],
			foreignColumns: [timeRecordWork.recordId, timeRecordWork.organizationId],
		}).onDelete("cascade"),
		check(
			"timeRecordAllocation_kind_target_chk",
			sql`(
				${table.allocationKind} = 'project' AND ${table.projectId} IS NOT NULL AND ${table.costCenterId} IS NULL
			) OR (
				${table.allocationKind} = 'cost_center' AND ${table.costCenterId} IS NOT NULL AND ${table.projectId} IS NULL
			)`,
		),
	],
);

export const timeRecordApprovalDecision = pgTable(
	"time_record_approval_decision",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recordId: uuid("record_id")
			.notNull(),
		actorEmployeeId: uuid("actor_employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		action: timeRecordApprovalDecisionActionEnum("action").notNull(),
		reason: text("reason"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("timeRecordApprovalDecision_organizationId_idx").on(table.organizationId),
		index("timeRecordApprovalDecision_recordId_idx").on(table.recordId),
		index("timeRecordApprovalDecision_actorEmployeeId_idx").on(table.actorEmployeeId),
		index("timeRecordApprovalDecision_createdAt_idx").on(table.createdAt),
		foreignKey({
			columns: [table.recordId, table.organizationId],
			foreignColumns: [timeRecord.id, timeRecord.organizationId],
		}).onDelete("cascade"),
	],
);
