import {
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	approvalChainStatusEnum,
	approvalPolicyApproverTypeEnum,
	approvalPolicyConditionOperatorEnum,
	approvalPolicyConditionTypeEnum,
	approvalPolicyOvertimeRiskEnum,
} from "./enums";
import { absenceCategory } from "./absence";
import { approvalRequest } from "./approval";
import { employee, location, team } from "./organization";

export const approvalPolicy = pgTable(
	"approval_policy",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		isActive: boolean("is_active").default(false).notNull(),
		priority: integer("priority").notNull(),
		createdBy: text("created_by").notNull().references(() => user.id),
		updatedBy: text("updated_by").references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("approvalPolicy_organizationId_idx").on(table.organizationId),
		uniqueIndex("approvalPolicy_id_organizationId_idx").on(table.id, table.organizationId),
		uniqueIndex("approvalPolicy_org_priority_idx").on(table.organizationId, table.priority),
	],
);

export const approvalPolicyCondition = pgTable(
	"approval_policy_condition",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		policyId: uuid("policy_id").notNull(),
		conditionType: approvalPolicyConditionTypeEnum("condition_type").notNull(),
		operator: approvalPolicyConditionOperatorEnum("operator").notNull(),
		valueJson: jsonb("value_json"),
		amountMin: numeric("amount_min", { precision: 12, scale: 2 }),
		amountMax: numeric("amount_max", { precision: 12, scale: 2 }),
		overtimeRisk: approvalPolicyOvertimeRiskEnum("overtime_risk"),
		teamId: uuid("team_id"),
		locationId: uuid("location_id"),
		absenceCategoryId: uuid("absence_category_id"),
		employeeGroupId: uuid("employee_group_id"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("approvalPolicyCondition_org_policy_idx").on(table.organizationId, table.policyId),
		index("approvalPolicyCondition_type_idx").on(table.conditionType),
		foreignKey({ columns: [table.policyId, table.organizationId], foreignColumns: [approvalPolicy.id, approvalPolicy.organizationId] }).onDelete("cascade"),
		foreignKey({ columns: [table.teamId, table.organizationId], foreignColumns: [team.id, team.organizationId] }).onDelete("cascade"),
		foreignKey({ columns: [table.locationId, table.organizationId], foreignColumns: [location.id, location.organizationId] }).onDelete("cascade"),
		foreignKey({ columns: [table.absenceCategoryId, table.organizationId], foreignColumns: [absenceCategory.id, absenceCategory.organizationId] }).onDelete("cascade"),
		foreignKey({ columns: [table.employeeGroupId, table.organizationId], foreignColumns: [employeeGroup.id, employeeGroup.organizationId] }).onDelete("cascade"),
	],
);

export const approvalPolicyStage = pgTable(
	"approval_policy_stage",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		policyId: uuid("policy_id").notNull(),
		stepOrder: integer("step_order").notNull(),
		label: text("label").notNull(),
		approverType: approvalPolicyApproverTypeEnum("approver_type").notNull(),
		approverEmployeeId: uuid("approver_employee_id"),
		fallbackBehavior: text("fallback_behavior").default("fail").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("approvalPolicyStage_org_policy_idx").on(table.organizationId, table.policyId),
		uniqueIndex("approvalPolicyStage_id_organizationId_idx").on(table.id, table.organizationId),
		uniqueIndex("approvalPolicyStage_policy_order_idx").on(table.policyId, table.stepOrder),
		foreignKey({ columns: [table.policyId, table.organizationId], foreignColumns: [approvalPolicy.id, approvalPolicy.organizationId] }).onDelete("cascade"),
		foreignKey({ columns: [table.approverEmployeeId, table.organizationId], foreignColumns: [employee.id, employee.organizationId] }),
	],
);

export const employeeGroup = pgTable(
	"employee_group",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("employeeGroup_organizationId_idx").on(table.organizationId),
		uniqueIndex("employeeGroup_id_organizationId_idx").on(table.id, table.organizationId),
		uniqueIndex("employeeGroup_org_name_idx").on(table.organizationId, table.name),
	],
);

export const employeeGroupMember = pgTable(
	"employee_group_member",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		groupId: uuid("group_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		createdBy: text("created_by").notNull().references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("employeeGroupMember_org_group_idx").on(table.organizationId, table.groupId),
		uniqueIndex("employeeGroupMember_group_employee_idx").on(table.groupId, table.employeeId),
		foreignKey({ columns: [table.groupId, table.organizationId], foreignColumns: [employeeGroup.id, employeeGroup.organizationId] }).onDelete("cascade"),
		foreignKey({ columns: [table.employeeId, table.organizationId], foreignColumns: [employee.id, employee.organizationId] }).onDelete("cascade"),
	],
);

export const approvalChainInstance = pgTable(
	"approval_chain_instance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		policyId: uuid("policy_id").notNull(),
		policyNameSnapshot: text("policy_name_snapshot").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: uuid("entity_id").notNull(),
		requesterEmployeeId: uuid("requester_employee_id").notNull(),
		currentStageOrder: integer("current_stage_order").notNull(),
		status: approvalChainStatusEnum("status").default("pending").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		uniqueIndex("approvalChainInstance_id_organizationId_idx").on(table.id, table.organizationId),
		index("approvalChainInstance_org_entity_idx").on(table.organizationId, table.entityType, table.entityId),
		index("approvalChainInstance_org_status_idx").on(table.organizationId, table.status),
		foreignKey({ columns: [table.policyId, table.organizationId], foreignColumns: [approvalPolicy.id, approvalPolicy.organizationId] }),
		foreignKey({ columns: [table.requesterEmployeeId, table.organizationId], foreignColumns: [employee.id, employee.organizationId] }),
	],
);

export const approvalChainStageInstance = pgTable(
	"approval_chain_stage_instance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		chainInstanceId: uuid("chain_instance_id").notNull(),
		policyStageId: uuid("policy_stage_id").notNull(),
		stepOrder: integer("step_order").notNull(),
		labelSnapshot: text("label_snapshot").notNull(),
		approverTypeSnapshot: text("approver_type_snapshot").notNull(),
		resolvedApproverEmployeeId: uuid("resolved_approver_employee_id").notNull(),
		approvalRequestId: uuid("approval_request_id"),
		status: approvalChainStatusEnum("status").default("pending").notNull(),
		decidedBy: uuid("decided_by"),
		decidedAt: timestamp("decided_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("approvalChainStageInstance_org_chain_idx").on(table.organizationId, table.chainInstanceId),
		uniqueIndex("approvalChainStageInstance_request_idx").on(table.approvalRequestId),
		uniqueIndex("approvalChainStageInstance_chain_order_idx").on(table.chainInstanceId, table.stepOrder),
		foreignKey({ columns: [table.chainInstanceId, table.organizationId], foreignColumns: [approvalChainInstance.id, approvalChainInstance.organizationId] }).onDelete("cascade"),
		foreignKey({ columns: [table.approvalRequestId, table.organizationId], foreignColumns: [approvalRequest.id, approvalRequest.organizationId] }),
		foreignKey({ columns: [table.resolvedApproverEmployeeId, table.organizationId], foreignColumns: [employee.id, employee.organizationId] }),
		foreignKey({ columns: [table.decidedBy, table.organizationId], foreignColumns: [employee.id, employee.organizationId] }),
	],
);
