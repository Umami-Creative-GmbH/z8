# Custom Approval Policy Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an organization-scoped approval policy builder that resolves first-match sequential approval chains for absences, travel expenses, overtime-risk workflows, and employee groups while preserving the existing unified approvals inbox.

**Architecture:** Add focused Drizzle schema tables for policy configuration, employee groups, and runtime chain state. Implement a pure domain matcher/resolver first, then persistence services that create chain instances and one current-stage `approvalRequest`. Integrate the resolver into source approval creation paths and expose settings UI/server actions for admin management and preview.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, PostgreSQL, Effect services, TanStack Form, TanStack Query, Tolgee, Vitest, Testing Library, pnpm.

---

## Scope Check

This is one dependent vertical slice. Schema, matching, chain progression, source-domain integration, and settings UI all depend on the same policy model. The plan keeps the feature testable by committing each layer independently and preserving the existing approval fallback until source integrations are enabled.

## File Structure

- Create `apps/webapp/src/db/schema/approval-policy.ts`: Drizzle tables for policy configuration, employee groups, and chain runtime state.
- Modify `apps/webapp/src/db/schema/enums.ts`: approval policy enums.
- Modify `apps/webapp/src/db/schema/index.ts`: export the new schema file.
- Modify `apps/webapp/src/db/schema/relations.ts`: add relations for new policy/group/chain tables.
- Create `apps/webapp/src/lib/approvals/policies/types.ts`: pure TypeScript domain types and constants shared by resolver, server actions, and UI.
- Create `apps/webapp/src/lib/approvals/policies/matcher.ts`: pure first-match policy matching and condition validation.
- Create `apps/webapp/src/lib/approvals/policies/matcher.test.ts`: unit tests for all first-version condition types.
- Create `apps/webapp/src/lib/approvals/policies/approver-resolution.ts`: pure and DB-backed helpers for resolving direct manager, manager's manager, org admin, and specific employee.
- Create `apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts`: unit tests for resolution edge cases.
- Create `apps/webapp/src/lib/approvals/policies/chain-service.ts`: Effect-backed chain creation/progression service.
- Create `apps/webapp/src/lib/approvals/policies/chain-service.test.ts`: unit tests for creating current-stage requests, progression, rejection, and stale conflict handling.
- Modify `apps/webapp/src/lib/approvals/server/shared.ts`: call chain progression hooks after current-stage approval/rejection when the `approvalRequest` belongs to a stage instance.
- Create `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.ts`: organization-scoped server actions for policies, employee groups, and preview.
- Create `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts`: permission and organization-scope tests.
- Create `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/page.tsx`: settings page shell.
- Create `apps/webapp/src/components/settings/approval-policy-management.tsx`: list page and action-panel orchestration.
- Create `apps/webapp/src/components/settings/approval-policy-dialog.tsx`: TanStack Form for policy details, conditions, and stages.
- Create `apps/webapp/src/components/settings/employee-group-management.tsx`: employee group and membership management.
- Create `apps/webapp/src/components/settings/approval-policy-preview.tsx`: preview/test panel.
- Create `apps/webapp/src/components/settings/approval-policy-dialog.test.tsx`: UI tests for form validation and stage rules.
- Modify `apps/webapp/src/components/settings/settings-config.ts`: add the settings entry and icon name.
- Modify `apps/webapp/src/components/settings/settings-icons.ts`: map the new icon.
- Modify source-domain creation paths after service tests pass: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`, `apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts`, and `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.ts`.

## Task 1: Schema And Exports

**Files:**
- Modify: `apps/webapp/src/db/schema/enums.ts`
- Create: `apps/webapp/src/db/schema/approval-policy.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Test: `apps/webapp/src/db/schema/__tests__/approval-policy-schema.test.ts`

- [ ] **Step 1: Write the failing schema export test**

```ts
import { describe, expect, it } from "vitest";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalPolicy,
	approvalPolicyCondition,
	approvalPolicyStage,
	employeeGroup,
	employeeGroupMember,
} from "@/db/schema";

describe("approval policy schema exports", () => {
	it("exports policy, group, and chain tables", () => {
		expect(approvalPolicy).toBeDefined();
		expect(approvalPolicyCondition).toBeDefined();
		expect(approvalPolicyStage).toBeDefined();
		expect(employeeGroup).toBeDefined();
		expect(employeeGroupMember).toBeDefined();
		expect(approvalChainInstance).toBeDefined();
		expect(approvalChainStageInstance).toBeDefined();
	});
});
```

- [ ] **Step 2: Run the schema export test and verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/db/schema/__tests__/approval-policy-schema.test.ts`

Expected: FAIL because the new schema exports do not exist.

- [ ] **Step 3: Add approval policy enums**

Add this block to `apps/webapp/src/db/schema/enums.ts` near the approval enums:

```ts
export const approvalPolicyConditionTypeEnum = pgEnum("approval_policy_condition_type", [
	"approval_type",
	"team",
	"location",
	"absence_category",
	"travel_expense_amount",
	"overtime_risk",
	"employee_group",
]);

export const approvalPolicyConditionOperatorEnum = pgEnum("approval_policy_condition_operator", [
	"equals",
	"in",
	"gte",
	"lte",
	"between",
]);

export const approvalPolicyApproverTypeEnum = pgEnum("approval_policy_approver_type", [
	"direct_manager",
	"manager_manager",
	"org_admin",
	"specific_employee",
]);

export const approvalChainStatusEnum = pgEnum("approval_chain_status", [
	"pending",
	"approved",
	"rejected",
	"cancelled",
]);

export const approvalPolicyOvertimeRiskEnum = pgEnum("approval_policy_overtime_risk", [
	"none",
	"warning",
	"violation",
]);
```

- [ ] **Step 4: Add the schema file**

Create `apps/webapp/src/db/schema/approval-policy.ts` with:

```ts
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
		uniqueIndex("approvalPolicy_org_priority_idx").on(table.organizationId, table.priority),
	],
);

export const approvalPolicyCondition = pgTable(
	"approval_policy_condition",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		policyId: uuid("policy_id").notNull().references(() => approvalPolicy.id, { onDelete: "cascade" }),
		conditionType: approvalPolicyConditionTypeEnum("condition_type").notNull(),
		operator: approvalPolicyConditionOperatorEnum("operator").notNull(),
		valueJson: jsonb("value_json"),
		amountMin: numeric("amount_min", { precision: 12, scale: 2 }),
		amountMax: numeric("amount_max", { precision: 12, scale: 2 }),
		overtimeRisk: approvalPolicyOvertimeRiskEnum("overtime_risk"),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		locationId: uuid("location_id").references(() => location.id, { onDelete: "cascade" }),
		absenceCategoryId: uuid("absence_category_id").references(() => absenceCategory.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("approvalPolicyCondition_org_policy_idx").on(table.organizationId, table.policyId),
		index("approvalPolicyCondition_type_idx").on(table.conditionType),
		foreignKey({ columns: [table.policyId, table.organizationId], foreignColumns: [approvalPolicy.id, approvalPolicy.organizationId] }),
	],
);

export const approvalPolicyStage = pgTable(
	"approval_policy_stage",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		policyId: uuid("policy_id").notNull().references(() => approvalPolicy.id, { onDelete: "cascade" }),
		stepOrder: integer("step_order").notNull(),
		label: text("label").notNull(),
		approverType: approvalPolicyApproverTypeEnum("approver_type").notNull(),
		approverEmployeeId: uuid("approver_employee_id").references(() => employee.id),
		fallbackBehavior: text("fallback_behavior").default("fail").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("approvalPolicyStage_org_policy_idx").on(table.organizationId, table.policyId),
		uniqueIndex("approvalPolicyStage_policy_order_idx").on(table.policyId, table.stepOrder),
		foreignKey({ columns: [table.policyId, table.organizationId], foreignColumns: [approvalPolicy.id, approvalPolicy.organizationId] }),
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
		uniqueIndex("employeeGroup_org_name_idx").on(table.organizationId, table.name),
	],
);

export const employeeGroupMember = pgTable(
	"employee_group_member",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		groupId: uuid("group_id").notNull().references(() => employeeGroup.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull().references(() => employee.id, { onDelete: "cascade" }),
		createdBy: text("created_by").notNull().references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("employeeGroupMember_org_group_idx").on(table.organizationId, table.groupId),
		uniqueIndex("employeeGroupMember_group_employee_idx").on(table.groupId, table.employeeId),
		foreignKey({ columns: [table.groupId, table.organizationId], foreignColumns: [employeeGroup.id, employeeGroup.organizationId] }),
	],
);

export const approvalChainInstance = pgTable(
	"approval_chain_instance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		policyId: uuid("policy_id").notNull().references(() => approvalPolicy.id),
		policyNameSnapshot: text("policy_name_snapshot").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: uuid("entity_id").notNull(),
		requesterEmployeeId: uuid("requester_employee_id").notNull().references(() => employee.id),
		currentStageOrder: integer("current_stage_order").notNull(),
		status: approvalChainStatusEnum("status").default("pending").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("approvalChainInstance_org_entity_idx").on(table.organizationId, table.entityType, table.entityId),
		index("approvalChainInstance_org_status_idx").on(table.organizationId, table.status),
	],
);

export const approvalChainStageInstance = pgTable(
	"approval_chain_stage_instance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		chainInstanceId: uuid("chain_instance_id").notNull().references(() => approvalChainInstance.id, { onDelete: "cascade" }),
		policyStageId: uuid("policy_stage_id").notNull().references(() => approvalPolicyStage.id),
		stepOrder: integer("step_order").notNull(),
		labelSnapshot: text("label_snapshot").notNull(),
		approverTypeSnapshot: text("approver_type_snapshot").notNull(),
		resolvedApproverEmployeeId: uuid("resolved_approver_employee_id").notNull().references(() => employee.id),
		approvalRequestId: uuid("approval_request_id").references(() => approvalRequest.id),
		status: approvalChainStatusEnum("status").default("pending").notNull(),
		decidedBy: uuid("decided_by").references(() => employee.id),
		decidedAt: timestamp("decided_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("approvalChainStageInstance_org_chain_idx").on(table.organizationId, table.chainInstanceId),
		uniqueIndex("approvalChainStageInstance_request_idx").on(table.approvalRequestId),
		uniqueIndex("approvalChainStageInstance_chain_order_idx").on(table.chainInstanceId, table.stepOrder),
	],
);
```

- [ ] **Step 5: Export the new schema**

Add this line to `apps/webapp/src/db/schema/index.ts` after `export * from "./approval";`:

```ts
export * from "./approval-policy";
```

- [ ] **Step 6: Add minimal relations**

Modify `apps/webapp/src/db/schema/relations.ts` imports to include the new tables:

```ts
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalPolicy,
	approvalPolicyCondition,
	approvalPolicyStage,
	employeeGroup,
	employeeGroupMember,
} from "./approval-policy";
```

Add these relation entries to `organizationRelations`:

```ts
approvalPolicies: many(approvalPolicy),
employeeGroups: many(employeeGroup),
approvalChainInstances: many(approvalChainInstance),
```

Add these relation exports after `organizationRelations`:

```ts
export const approvalPolicyRelations = relations(approvalPolicy, ({ one, many }) => ({
	organization: one(organization, { fields: [approvalPolicy.organizationId], references: [organization.id] }),
	conditions: many(approvalPolicyCondition),
	stages: many(approvalPolicyStage),
}));

export const approvalPolicyConditionRelations = relations(approvalPolicyCondition, ({ one }) => ({
	policy: one(approvalPolicy, { fields: [approvalPolicyCondition.policyId], references: [approvalPolicy.id] }),
}));

export const approvalPolicyStageRelations = relations(approvalPolicyStage, ({ one }) => ({
	policy: one(approvalPolicy, { fields: [approvalPolicyStage.policyId], references: [approvalPolicy.id] }),
	specificApprover: one(employee, { fields: [approvalPolicyStage.approverEmployeeId], references: [employee.id] }),
}));

export const employeeGroupRelations = relations(employeeGroup, ({ one, many }) => ({
	organization: one(organization, { fields: [employeeGroup.organizationId], references: [organization.id] }),
	members: many(employeeGroupMember),
}));

export const employeeGroupMemberRelations = relations(employeeGroupMember, ({ one }) => ({
	group: one(employeeGroup, { fields: [employeeGroupMember.groupId], references: [employeeGroup.id] }),
	employee: one(employee, { fields: [employeeGroupMember.employeeId], references: [employee.id] }),
}));

export const approvalChainInstanceRelations = relations(approvalChainInstance, ({ one, many }) => ({
	policy: one(approvalPolicy, { fields: [approvalChainInstance.policyId], references: [approvalPolicy.id] }),
	requester: one(employee, { fields: [approvalChainInstance.requesterEmployeeId], references: [employee.id] }),
	stages: many(approvalChainStageInstance),
}));

export const approvalChainStageInstanceRelations = relations(approvalChainStageInstance, ({ one }) => ({
	chain: one(approvalChainInstance, { fields: [approvalChainStageInstance.chainInstanceId], references: [approvalChainInstance.id] }),
	policyStage: one(approvalPolicyStage, { fields: [approvalChainStageInstance.policyStageId], references: [approvalPolicyStage.id] }),
	approvalRequest: one(approvalRequest, { fields: [approvalChainStageInstance.approvalRequestId], references: [approvalRequest.id] }),
	resolvedApprover: one(employee, { fields: [approvalChainStageInstance.resolvedApproverEmployeeId], references: [employee.id] }),
}));
```

- [ ] **Step 7: Run the schema export test and verify it passes**

Run: `pnpm --filter webapp test apps/webapp/src/db/schema/__tests__/approval-policy-schema.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit schema work**

```bash
git add apps/webapp/src/db/schema/enums.ts apps/webapp/src/db/schema/approval-policy.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/__tests__/approval-policy-schema.test.ts
git commit -m "feat: add approval policy schema"
```

## Task 2: Pure Policy Types And Matcher

**Files:**
- Create: `apps/webapp/src/lib/approvals/policies/types.ts`
- Create: `apps/webapp/src/lib/approvals/policies/matcher.ts`
- Test: `apps/webapp/src/lib/approvals/policies/matcher.test.ts`

- [ ] **Step 1: Write matcher tests**

Create `apps/webapp/src/lib/approvals/policies/matcher.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findMatchingPolicy, validatePolicyDraft } from "./matcher";
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "./types";

const context: ApprovalPolicyEvaluationContext = {
	organizationId: "org_1",
	approvalType: "absence_entry",
	requesterEmployeeId: "emp_1",
	teamId: "team_1",
	locationId: "loc_1",
	absenceCategoryId: "cat_1",
	travelExpenseAmount: 750,
	overtimeRisk: "warning",
	employeeGroupIds: ["group_1"],
	entityType: "absence_entry",
	entityId: "entity_1",
};

const matchingPolicy: ApprovalPolicyDraft = {
	id: "policy_1",
	organizationId: "org_1",
	name: "High control absences",
	isActive: true,
	priority: 10,
	conditions: [
		{ conditionType: "approval_type", operator: "in", values: ["absence_entry"] },
		{ conditionType: "team", operator: "equals", value: "team_1" },
		{ conditionType: "location", operator: "equals", value: "loc_1" },
		{ conditionType: "absence_category", operator: "equals", value: "cat_1" },
		{ conditionType: "employee_group", operator: "in", values: ["group_1", "group_2"] },
		{ conditionType: "overtime_risk", operator: "in", values: ["warning", "violation"] },
		{ conditionType: "travel_expense_amount", operator: "between", amountMin: 500, amountMax: 1000 },
	],
	stages: [{ id: "stage_1", stepOrder: 1, label: "Manager", approverType: "direct_manager" }],
};

describe("findMatchingPolicy", () => {
	it("selects the first active policy by ascending priority where every condition matches", () => {
		const result = findMatchingPolicy(context, [
			{ ...matchingPolicy, id: "later", priority: 20 },
			{ ...matchingPolicy, id: "first", priority: 5 },
		]);

		expect(result?.id).toBe("first");
	});

	it("returns null when no active policy matches", () => {
		const result = findMatchingPolicy(context, [
			{ ...matchingPolicy, isActive: false },
			{ ...matchingPolicy, conditions: [{ conditionType: "team", operator: "equals", value: "team_x" }] },
		]);

		expect(result).toBeNull();
	});
});

describe("validatePolicyDraft", () => {
	it("rejects active policies without stages", () => {
		expect(validatePolicyDraft({ ...matchingPolicy, stages: [] })).toEqual([
			"Active policies require at least one approval stage.",
		]);
	});

	it("rejects unsupported team lead stages", () => {
		expect(
			validatePolicyDraft({
				...matchingPolicy,
				stages: [{ id: "stage_1", stepOrder: 1, label: "Team Lead", approverType: "team_lead" }],
			}),
		).toContain("Team lead approver stages are not available until team lead relationships exist.");
	});
});
```

- [ ] **Step 2: Run matcher tests and verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/policies/matcher.test.ts`

Expected: FAIL because `types.ts` and `matcher.ts` do not exist.

- [ ] **Step 3: Add policy domain types**

Create `apps/webapp/src/lib/approvals/policies/types.ts`:

```ts
import type { ApprovalType } from "@/lib/approvals/domain/types";

export type ApprovalPolicyConditionType =
	| "approval_type"
	| "team"
	| "location"
	| "absence_category"
	| "travel_expense_amount"
	| "overtime_risk"
	| "employee_group";

export type ApprovalPolicyConditionOperator = "equals" | "in" | "gte" | "lte" | "between";
export type ApprovalPolicyApproverType = "direct_manager" | "manager_manager" | "org_admin" | "specific_employee" | "team_lead";
export type ApprovalPolicyOvertimeRisk = "none" | "warning" | "violation";

export interface ApprovalPolicyEvaluationContext {
	organizationId: string;
	approvalType: ApprovalType;
	requesterEmployeeId: string;
	teamId: string | null;
	locationId: string | null;
	absenceCategoryId: string | null;
	travelExpenseAmount: number | null;
	overtimeRisk: ApprovalPolicyOvertimeRisk | null;
	employeeGroupIds: string[];
	entityType: string;
	entityId: string;
}

export interface ApprovalPolicyConditionDraft {
	conditionType: ApprovalPolicyConditionType;
	operator: ApprovalPolicyConditionOperator;
	value?: string;
	values?: string[];
	amountMin?: number;
	amountMax?: number;
}

export interface ApprovalPolicyStageDraft {
	id: string;
	stepOrder: number;
	label: string;
	approverType: ApprovalPolicyApproverType;
	approverEmployeeId?: string;
}

export interface ApprovalPolicyDraft {
	id: string;
	organizationId: string;
	name: string;
	isActive: boolean;
	priority: number;
	conditions: ApprovalPolicyConditionDraft[];
	stages: ApprovalPolicyStageDraft[];
}
```

- [ ] **Step 4: Add matcher implementation**

Create `apps/webapp/src/lib/approvals/policies/matcher.ts`:

```ts
import type {
	ApprovalPolicyConditionDraft,
	ApprovalPolicyDraft,
	ApprovalPolicyEvaluationContext,
} from "./types";

function stringList(condition: ApprovalPolicyConditionDraft): string[] {
	return condition.values ?? (condition.value ? [condition.value] : []);
}

function matchesString(value: string | null, condition: ApprovalPolicyConditionDraft) {
	if (!value) {
		return false;
	}

	if (condition.operator === "equals") {
		return value === condition.value;
	}

	if (condition.operator === "in") {
		return stringList(condition).includes(value);
	}

	return false;
}

function matchesAmount(amount: number | null, condition: ApprovalPolicyConditionDraft) {
	if (amount === null) {
		return false;
	}

	if (condition.operator === "gte") {
		return typeof condition.amountMin === "number" && amount >= condition.amountMin;
	}

	if (condition.operator === "lte") {
		return typeof condition.amountMax === "number" && amount <= condition.amountMax;
	}

	if (condition.operator === "between") {
		return (
			typeof condition.amountMin === "number" &&
			typeof condition.amountMax === "number" &&
			amount >= condition.amountMin &&
			amount <= condition.amountMax
		);
	}

	return false;
}

export function matchesCondition(
	context: ApprovalPolicyEvaluationContext,
	condition: ApprovalPolicyConditionDraft,
) {
	switch (condition.conditionType) {
		case "approval_type":
			return matchesString(context.approvalType, condition);
		case "team":
			return matchesString(context.teamId, condition);
		case "location":
			return matchesString(context.locationId, condition);
		case "absence_category":
			return matchesString(context.absenceCategoryId, condition);
		case "employee_group":
			return stringList(condition).some((groupId) => context.employeeGroupIds.includes(groupId));
		case "overtime_risk":
			return matchesString(context.overtimeRisk, condition);
		case "travel_expense_amount":
			return matchesAmount(context.travelExpenseAmount, condition);
	}
}

export function findMatchingPolicy(
	context: ApprovalPolicyEvaluationContext,
	policies: ApprovalPolicyDraft[],
) {
	return (
		policies
			.filter((policy) => policy.isActive && policy.organizationId === context.organizationId)
			.sort((a, b) => a.priority - b.priority)
			.find((policy) => policy.conditions.every((condition) => matchesCondition(context, condition))) ?? null
	);
}

export function validatePolicyDraft(policy: ApprovalPolicyDraft): string[] {
	const errors: string[] = [];

	if (policy.isActive && policy.stages.length === 0) {
		errors.push("Active policies require at least one approval stage.");
	}

	for (const stage of policy.stages) {
		if (stage.approverType === "team_lead") {
			errors.push("Team lead approver stages are not available until team lead relationships exist.");
		}

		if (stage.approverType === "specific_employee" && !stage.approverEmployeeId) {
			errors.push(`Stage ${stage.stepOrder} requires a specific employee approver.`);
		}
	}

	return errors;
}
```

- [ ] **Step 5: Run matcher tests and verify they pass**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/policies/matcher.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit matcher work**

```bash
git add apps/webapp/src/lib/approvals/policies/types.ts apps/webapp/src/lib/approvals/policies/matcher.ts apps/webapp/src/lib/approvals/policies/matcher.test.ts
git commit -m "feat: add approval policy matcher"
```

## Task 3: Approver Resolution

**Files:**
- Create: `apps/webapp/src/lib/approvals/policies/approver-resolution.ts`
- Test: `apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts`

- [ ] **Step 1: Write approver resolution tests**

Create `apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveApproverFromDirectory } from "./approver-resolution";
import type { ApprovalPolicyStageDraft } from "./types";

const employees = [
	{ id: "emp_requester", organizationId: "org_1", isActive: true, role: "employee" as const },
	{ id: "emp_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
	{ id: "emp_admin", organizationId: "org_1", isActive: true, role: "admin" as const },
	{ id: "emp_other_org", organizationId: "org_2", isActive: true, role: "admin" as const },
];

const managerLinks = [{ employeeId: "emp_requester", managerId: "emp_manager" }];

function stage(input: Partial<ApprovalPolicyStageDraft>): ApprovalPolicyStageDraft {
	return { id: "stage_1", stepOrder: 1, label: "Stage", approverType: "direct_manager", ...input };
}

describe("resolveApproverFromDirectory", () => {
	it("resolves direct manager inside the organization", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "direct_manager" }),
				employees,
				managerLinks,
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_manager" });
	});

	it("resolves organization admin inside the organization", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "org_admin" }),
				employees,
				managerLinks,
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_admin" });
	});

	it("rejects cross-organization specific approvers", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "specific_employee", approverEmployeeId: "emp_other_org" }),
				employees,
				managerLinks,
			}),
		).toEqual({ ok: false, reason: "Specific approver is not active in this organization." });
	});
});
```

- [ ] **Step 2: Run approver resolution tests and verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts`

Expected: FAIL because `approver-resolution.ts` does not exist.

- [ ] **Step 3: Implement pure approver resolution**

Create `apps/webapp/src/lib/approvals/policies/approver-resolution.ts`:

```ts
import type { ApprovalPolicyStageDraft } from "./types";

export interface ApproverDirectoryEmployee {
	id: string;
	organizationId: string;
	isActive: boolean;
	role: "admin" | "manager" | "employee";
}

export interface ApproverDirectoryManagerLink {
	employeeId: string;
	managerId: string;
}

export type ApproverResolutionResult =
	| { ok: true; approverEmployeeId: string }
	| { ok: false; reason: string };

interface ResolveApproverFromDirectoryInput {
	organizationId: string;
	requesterEmployeeId: string;
	stage: ApprovalPolicyStageDraft;
	employees: ApproverDirectoryEmployee[];
	managerLinks: ApproverDirectoryManagerLink[];
}

function activeEmployeeInOrg(
	employees: ApproverDirectoryEmployee[],
	organizationId: string,
	employeeId: string | undefined,
) {
	return employees.find(
		(employee) =>
			employee.id === employeeId &&
			employee.organizationId === organizationId &&
			employee.isActive,
	);
}

function directManagerId(managerLinks: ApproverDirectoryManagerLink[], employeeId: string) {
	return managerLinks.find((link) => link.employeeId === employeeId)?.managerId;
}

export function resolveApproverFromDirectory(
	input: ResolveApproverFromDirectoryInput,
): ApproverResolutionResult {
	const { organizationId, requesterEmployeeId, stage, employees, managerLinks } = input;

	if (stage.approverType === "direct_manager") {
		const manager = activeEmployeeInOrg(
			employees,
			organizationId,
			directManagerId(managerLinks, requesterEmployeeId),
		);
		return manager
			? { ok: true, approverEmployeeId: manager.id }
			: { ok: false, reason: "Requester has no active direct manager in this organization." };
	}

	if (stage.approverType === "manager_manager") {
		const managerId = directManagerId(managerLinks, requesterEmployeeId);
		const secondManager = activeEmployeeInOrg(
			employees,
			organizationId,
			managerId ? directManagerId(managerLinks, managerId) : undefined,
		);
		return secondManager
			? { ok: true, approverEmployeeId: secondManager.id }
			: { ok: false, reason: "Requester manager has no active manager in this organization." };
	}

	if (stage.approverType === "org_admin") {
		const admin = employees.find(
			(employee) =>
				employee.organizationId === organizationId && employee.isActive && employee.role === "admin",
		);
		return admin
			? { ok: true, approverEmployeeId: admin.id }
			: { ok: false, reason: "Organization has no active admin approver." };
	}

	if (stage.approverType === "specific_employee") {
		const approver = activeEmployeeInOrg(employees, organizationId, stage.approverEmployeeId);
		return approver
			? { ok: true, approverEmployeeId: approver.id }
			: { ok: false, reason: "Specific approver is not active in this organization." };
	}

	return { ok: false, reason: "Team lead approver stages are not available." };
}
```

- [ ] **Step 4: Run approver resolution tests and verify they pass**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit approver resolution work**

```bash
git add apps/webapp/src/lib/approvals/policies/approver-resolution.ts apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts
git commit -m "feat: resolve approval policy approvers"
```

## Task 4: Chain Service And Stage Progression

**Files:**
- Create: `apps/webapp/src/lib/approvals/policies/chain-service.ts`
- Test: `apps/webapp/src/lib/approvals/policies/chain-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/shared.ts`

- [ ] **Step 1: Write chain progression tests with an in-memory repository**

Create `apps/webapp/src/lib/approvals/policies/chain-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { approveCurrentStageInMemory, createChainInMemory, rejectCurrentStageInMemory } from "./chain-service";
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "./types";

const context: ApprovalPolicyEvaluationContext = {
	organizationId: "org_1",
	approvalType: "absence_entry",
	requesterEmployeeId: "emp_requester",
	teamId: null,
	locationId: null,
	absenceCategoryId: null,
	travelExpenseAmount: null,
	overtimeRisk: null,
	employeeGroupIds: [],
	entityType: "absence_entry",
	entityId: "absence_1",
};

const policy: ApprovalPolicyDraft = {
	id: "policy_1",
	organizationId: "org_1",
	name: "Two step",
	isActive: true,
	priority: 1,
	conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
	stages: [
		{ id: "stage_1", stepOrder: 1, label: "Manager", approverType: "specific_employee", approverEmployeeId: "emp_manager" },
		{ id: "stage_2", stepOrder: 2, label: "Admin", approverType: "specific_employee", approverEmployeeId: "emp_admin" },
	],
};

describe("chain service in-memory model", () => {
	it("creates one current-stage approval request", () => {
		const chain = createChainInMemory({ context, policy });

		expect(chain.status).toBe("pending");
		expect(chain.stages).toHaveLength(2);
		expect(chain.stages[0].status).toBe("pending");
		expect(chain.stages[0].approvalRequestId).toBe("request_stage_1");
		expect(chain.stages[1].approvalRequestId).toBeNull();
	});

	it("advances to the next stage after approval", () => {
		const chain = createChainInMemory({ context, policy });
		const advanced = approveCurrentStageInMemory(chain, "emp_manager");

		expect(advanced.status).toBe("pending");
		expect(advanced.currentStageOrder).toBe(2);
		expect(advanced.stages[0].status).toBe("approved");
		expect(advanced.stages[1].status).toBe("pending");
		expect(advanced.stages[1].approvalRequestId).toBe("request_stage_2");
	});

	it("rejects the chain at the current stage", () => {
		const chain = createChainInMemory({ context, policy });
		const rejected = rejectCurrentStageInMemory(chain, "emp_manager");

		expect(rejected.status).toBe("rejected");
		expect(rejected.stages[0].status).toBe("rejected");
		expect(rejected.stages[1].approvalRequestId).toBeNull();
	});
});
```

- [ ] **Step 2: Run chain tests and verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/policies/chain-service.test.ts`

Expected: FAIL because `chain-service.ts` does not exist.

- [ ] **Step 3: Add the in-memory chain model and exported service shape**

Create `apps/webapp/src/lib/approvals/policies/chain-service.ts`:

```ts
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "./types";

type ChainStatus = "pending" | "approved" | "rejected" | "cancelled";

interface CreateChainInMemoryInput {
	context: ApprovalPolicyEvaluationContext;
	policy: ApprovalPolicyDraft;
}

export interface ChainStageInMemory {
	id: string;
	policyStageId: string;
	stepOrder: number;
	labelSnapshot: string;
	resolvedApproverEmployeeId: string;
	approvalRequestId: string | null;
	status: ChainStatus;
	decidedBy: string | null;
}

export interface ChainInMemory {
	id: string;
	organizationId: string;
	policyId: string;
	entityType: string;
	entityId: string;
	requesterEmployeeId: string;
	currentStageOrder: number;
	status: ChainStatus;
	stages: ChainStageInMemory[];
}

function requestIdForStage(stepOrder: number) {
	return `request_stage_${stepOrder}`;
}

export function createChainInMemory(input: CreateChainInMemoryInput): ChainInMemory {
	const firstStageOrder = Math.min(...input.policy.stages.map((stage) => stage.stepOrder));

	return {
		id: "chain_1",
		organizationId: input.context.organizationId,
		policyId: input.policy.id,
		entityType: input.context.entityType,
		entityId: input.context.entityId,
		requesterEmployeeId: input.context.requesterEmployeeId,
		currentStageOrder: firstStageOrder,
		status: "pending",
		stages: input.policy.stages
			.slice()
			.sort((a, b) => a.stepOrder - b.stepOrder)
			.map((stage) => ({
				id: `stage_instance_${stage.stepOrder}`,
				policyStageId: stage.id,
				stepOrder: stage.stepOrder,
				labelSnapshot: stage.label,
				resolvedApproverEmployeeId: stage.approverEmployeeId ?? "",
				approvalRequestId: stage.stepOrder === firstStageOrder ? requestIdForStage(stage.stepOrder) : null,
				status: stage.stepOrder === firstStageOrder ? "pending" : "cancelled",
				decidedBy: null,
			})),
	};
}

export function approveCurrentStageInMemory(chain: ChainInMemory, decidedBy: string): ChainInMemory {
	const stages = chain.stages.map((stage) =>
		stage.stepOrder === chain.currentStageOrder
			? { ...stage, status: "approved" as const, decidedBy }
			: stage,
	);
	const nextStage = stages.find((stage) => stage.stepOrder > chain.currentStageOrder);

	if (!nextStage) {
		return { ...chain, status: "approved", stages };
	}

	return {
		...chain,
		currentStageOrder: nextStage.stepOrder,
		stages: stages.map((stage) =>
			stage.stepOrder === nextStage.stepOrder
				? { ...stage, status: "pending", approvalRequestId: requestIdForStage(stage.stepOrder) }
				: stage,
		),
	};
}

export function rejectCurrentStageInMemory(chain: ChainInMemory, decidedBy: string): ChainInMemory {
	return {
		...chain,
		status: "rejected",
		stages: chain.stages.map((stage) =>
			stage.stepOrder === chain.currentStageOrder
				? { ...stage, status: "rejected", decidedBy }
				: stage,
		),
	};
}
```

- [ ] **Step 4: Run chain tests and verify they pass**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/policies/chain-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Add DB-backed chain service after pure behavior is covered**

Extend `chain-service.ts` with exported Effect functions using the schema from Task 1:

```ts
export const APPROVAL_POLICY_CHAIN_NOT_CONFIGURED = "approval_policy_chain_not_configured";

export interface CreateChainForPolicyInput {
	organizationId: string;
	entityType: string;
	entityId: string;
	requesterEmployeeId: string;
	policy: ApprovalPolicyDraft;
	resolvedStages: Array<{ policyStageId: string; stepOrder: number; label: string; approverEmployeeId: string }>;
}

export interface ChainProgressionInput {
	approvalRequestId: string;
	actorEmployeeId: string;
	action: "approve" | "reject";
}
```

Then implement DB persistence with these invariants:

- Insert `approval_chain_instance` before stage instances.
- Insert all `approval_chain_stage_instance` rows.
- Insert exactly one `approvalRequest` for the lowest `stepOrder`.
- Update that stage instance with the created `approvalRequest.id`.
- On approval, update the current stage only when `status = "pending"`.
- If another stage exists, insert exactly one next-stage `approvalRequest` and link it.
- On final approval, mark chain `approved` and return `{ completed: true }` so the source domain can run final side effects.
- On rejection, mark stage and chain `rejected` and return `{ rejected: true }` so the source domain can run rejection side effects.

- [ ] **Step 6: Modify shared approval action flow to call chain progression**

In `apps/webapp/src/lib/approvals/server/shared.ts`, after `updatePendingApprovalRequest` succeeds and before final domain side effects, look up whether the current `approval.id` is linked from `approvalChainStageInstance.approvalRequestId`. If linked, call the chain progression service. Only run source-domain final approval side effects when chain progression returns completed or rejected.

Use this guard in the implementation:

```ts
const chainResult = yield* _(progressApprovalChainIfLinked(dbService, {
	approvalRequestId: approval.id,
	actorEmployeeId: currentEmployee.id,
	action,
}));

const shouldRunDomainSideEffect =
	chainResult.kind === "not_linked" || chainResult.kind === "chain_completed" || chainResult.kind === "chain_rejected";
```

- [ ] **Step 7: Add tests for linked and unlinked approval behavior**

Extend `apps/webapp/src/lib/approvals/server/shared.test.ts` with tests named:

```ts
it("continues existing side effects for unlinked approval requests", async () => {});
it("does not run final approve side effects for intermediate chain stages", async () => {});
it("runs final approve side effects when the last chain stage completes", async () => {});
it("runs rejection side effects when any chain stage is rejected", async () => {});
```

Expected assertions:

- Unlinked requests call `updateEntity` once.
- Intermediate linked approval calls `updateEntity` zero times.
- Final linked approval calls `updateEntity` once.
- Linked rejection calls rejection update once.

- [ ] **Step 8: Run chain and shared approval tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/policies/chain-service.test.ts apps/webapp/src/lib/approvals/server/shared.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit chain work**

```bash
git add apps/webapp/src/lib/approvals/policies/chain-service.ts apps/webapp/src/lib/approvals/policies/chain-service.test.ts apps/webapp/src/lib/approvals/server/shared.ts apps/webapp/src/lib/approvals/server/shared.test.ts
git commit -m "feat: progress sequential approval chains"
```

## Task 5: Policy Repository, Preview, And Admin Server Actions

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts`

- [ ] **Step 1: Write server action tests for validation and scoping**

Create `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts` with tests named:

```ts
import { describe, expect, it } from "vitest";
import { normalizeApprovalPolicyInputForTest, previewApprovalPolicyForTest } from "./actions";

describe("approval policy settings actions", () => {
	it("normalizes policy input and rejects active policies without stages", () => {
		const result = normalizeApprovalPolicyInputForTest({
			name: "Escalated absences",
			description: "",
			isActive: true,
			priority: 10,
			conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
			stages: [],
		});

		expect(result).toEqual({ success: false, error: "Active policies require at least one approval stage." });
	});

	it("previews the first matching policy and resolved approver labels", () => {
		const result = previewApprovalPolicyForTest({
			context: {
				organizationId: "org_1",
				approvalType: "absence_entry",
				requesterEmployeeId: "emp_requester",
				teamId: null,
				locationId: null,
				absenceCategoryId: null,
				travelExpenseAmount: null,
				overtimeRisk: null,
				employeeGroupIds: [],
				entityType: "absence_entry",
				entityId: "absence_1",
			},
			policies: [
				{
					id: "policy_1",
					organizationId: "org_1",
					name: "Absence chain",
					isActive: true,
					priority: 1,
					conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
					stages: [{ id: "stage_1", stepOrder: 1, label: "Manager", approverType: "specific_employee", approverEmployeeId: "emp_manager" }],
				},
			],
			employees: [{ id: "emp_manager", organizationId: "org_1", isActive: true, role: "manager" }],
			managerLinks: [],
		});

		expect(result).toEqual({
			matchedPolicyId: "policy_1",
			matchedPolicyName: "Absence chain",
			stages: [{ label: "Manager", approverEmployeeId: "emp_manager", status: "resolved" }],
		});
	});
});
```

- [ ] **Step 2: Run server action tests and verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts`

Expected: FAIL because `actions.ts` does not exist.

- [ ] **Step 3: Implement testable helpers and server actions**

Create `actions.ts` with exports:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { approvalPolicy, approvalPolicyCondition, approvalPolicyStage, employeeGroup, employeeGroupMember } from "@/db/schema";
import { findMatchingPolicy, validatePolicyDraft } from "@/lib/approvals/policies/matcher";
import { resolveApproverFromDirectory, type ApproverDirectoryEmployee, type ApproverDirectoryManagerLink } from "@/lib/approvals/policies/approver-resolution";
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "@/lib/approvals/policies/types";
import { getCurrentEmployee } from "@/app/[locale]/(app)/absences/current-employee";

const policyInputSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	isActive: z.boolean(),
	priority: z.number().int().min(1),
	conditions: z.array(z.object({
		conditionType: z.enum(["approval_type", "team", "location", "absence_category", "travel_expense_amount", "overtime_risk", "employee_group"]),
		operator: z.enum(["equals", "in", "gte", "lte", "between"]),
		value: z.string().optional(),
		values: z.array(z.string()).optional(),
		amountMin: z.number().optional(),
		amountMax: z.number().optional(),
	})),
	stages: z.array(z.object({
		id: z.string(),
		stepOrder: z.number().int().min(1),
		label: z.string().min(1),
		approverType: z.enum(["direct_manager", "manager_manager", "org_admin", "specific_employee", "team_lead"]),
		approverEmployeeId: z.string().optional(),
	})),
});

type PolicyInput = z.infer<typeof policyInputSchema>;

export function normalizeApprovalPolicyInputForTest(input: PolicyInput) {
	const parsed = policyInputSchema.safeParse(input);
	if (!parsed.success) {
		return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid policy input." };
	}

	const draft: ApprovalPolicyDraft = {
		id: "draft",
		organizationId: "draft_org",
		...parsed.data,
	};
	const errors = validatePolicyDraft(draft);
	if (errors.length > 0) {
		return { success: false as const, error: errors[0] };
	}

	return { success: true as const, data: parsed.data };
}

export function previewApprovalPolicyForTest(input: {
	context: ApprovalPolicyEvaluationContext;
	policies: ApprovalPolicyDraft[];
	employees: ApproverDirectoryEmployee[];
	managerLinks: ApproverDirectoryManagerLink[];
}) {
	const policy = findMatchingPolicy(input.context, input.policies);
	if (!policy) {
		return { matchedPolicyId: null, matchedPolicyName: null, stages: [] };
	}

	return {
		matchedPolicyId: policy.id,
		matchedPolicyName: policy.name,
		stages: policy.stages.map((stage) => {
			const resolved = resolveApproverFromDirectory({
				organizationId: input.context.organizationId,
				requesterEmployeeId: input.context.requesterEmployeeId,
				stage,
				employees: input.employees,
				managerLinks: input.managerLinks,
			});
			return resolved.ok
				? { label: stage.label, approverEmployeeId: resolved.approverEmployeeId, status: "resolved" as const }
				: { label: stage.label, approverEmployeeId: null, status: "unresolved" as const, reason: resolved.reason };
		}),
	};
}

async function requirePolicyAdmin() {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee || currentEmployee.role !== "admin") {
		throw new Error("Only organization admins can manage approval policies.");
	}
	return currentEmployee;
}

export async function getApprovalPolicies() {
	const currentEmployee = await requirePolicyAdmin();
	return db.query.approvalPolicy.findMany({
		where: (table, { eq }) => eq(table.organizationId, currentEmployee.organizationId),
		with: { conditions: true, stages: true },
		orderBy: (table, { asc }) => [asc(table.priority)],
	});
}

export async function upsertApprovalPolicy(input: PolicyInput & { id?: string }) {
	const currentEmployee = await requirePolicyAdmin();
	const normalized = normalizeApprovalPolicyInputForTest(input);
	if (!normalized.success) {
		return normalized;
	}

	await db.transaction(async (tx) => {
		const [savedPolicy] = await tx
			.insert(approvalPolicy)
			.values({
				id: input.id,
				organizationId: currentEmployee.organizationId,
				name: normalized.data.name,
				description: normalized.data.description || null,
				isActive: normalized.data.isActive,
				priority: normalized.data.priority,
				createdBy: currentEmployee.userId,
				updatedBy: currentEmployee.userId,
			})
			.onConflictDoUpdate({
				target: approvalPolicy.id,
				set: {
					name: normalized.data.name,
					description: normalized.data.description || null,
					isActive: normalized.data.isActive,
					priority: normalized.data.priority,
					updatedBy: currentEmployee.userId,
				},
			})
			.returning();

		await tx.delete(approvalPolicyCondition).where((table, { eq }) => eq(table.policyId, savedPolicy.id));
		await tx.delete(approvalPolicyStage).where((table, { eq }) => eq(table.policyId, savedPolicy.id));

		if (normalized.data.conditions.length > 0) {
			await tx.insert(approvalPolicyCondition).values(normalized.data.conditions.map((condition) => ({
				organizationId: currentEmployee.organizationId,
				policyId: savedPolicy.id,
				conditionType: condition.conditionType,
				operator: condition.operator,
				valueJson: { value: condition.value, values: condition.values },
				amountMin: condition.amountMin?.toString(),
				amountMax: condition.amountMax?.toString(),
			})));
		}

		await tx.insert(approvalPolicyStage).values(normalized.data.stages.map((stage) => ({
			organizationId: currentEmployee.organizationId,
			policyId: savedPolicy.id,
			stepOrder: stage.stepOrder,
			label: stage.label,
			approverType: stage.approverType,
			approverEmployeeId: stage.approverEmployeeId,
		})));
	});

	revalidatePath("/settings/approval-policies");
	return { success: true as const };
}
```

The imported `getCurrentEmployee` returns the active employee context used by existing app approval/settings paths. Keep `requirePolicyAdmin` constrained to the return shape `{ id, userId, organizationId, role }` before using it in policy writes.

- [ ] **Step 4: Add employee group actions**

Add exports to the same `actions.ts`:

```ts
export async function getEmployeeGroups() {
	const currentEmployee = await requirePolicyAdmin();
	return db.query.employeeGroup.findMany({
		where: (table, { eq }) => eq(table.organizationId, currentEmployee.organizationId),
		with: { members: true },
	});
}

export async function upsertEmployeeGroup(input: {
	id?: string;
	name: string;
	description?: string;
	isActive: boolean;
	employeeIds: string[];
}) {
	const currentEmployee = await requirePolicyAdmin();
	if (!input.name.trim()) {
		return { success: false as const, error: "Employee group name is required." };
	}

	await db.transaction(async (tx) => {
		const [group] = await tx
			.insert(employeeGroup)
			.values({
				id: input.id,
				organizationId: currentEmployee.organizationId,
				name: input.name.trim(),
				description: input.description?.trim() || null,
				isActive: input.isActive,
			})
			.onConflictDoUpdate({
				target: employeeGroup.id,
				set: { name: input.name.trim(), description: input.description?.trim() || null, isActive: input.isActive },
			})
			.returning();

		await tx.delete(employeeGroupMember).where((table, { eq }) => eq(table.groupId, group.id));
		if (input.employeeIds.length > 0) {
			await tx.insert(employeeGroupMember).values(input.employeeIds.map((employeeId) => ({
				organizationId: currentEmployee.organizationId,
				groupId: group.id,
				employeeId,
				createdBy: currentEmployee.userId,
			})));
		}
	});

	revalidatePath("/settings/approval-policies");
	return { success: true as const };
}
```

- [ ] **Step 5: Run server action tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit server action work**

```bash
git add "apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.ts" "apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts"
git commit -m "feat: manage approval policies"
```

## Task 6: Settings UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/page.tsx`
- Create: `apps/webapp/src/components/settings/approval-policy-management.tsx`
- Create: `apps/webapp/src/components/settings/approval-policy-dialog.tsx`
- Create: `apps/webapp/src/components/settings/employee-group-management.tsx`
- Create: `apps/webapp/src/components/settings/approval-policy-preview.tsx`
- Test: `apps/webapp/src/components/settings/approval-policy-dialog.test.tsx`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/components/settings/settings-icons.ts`

- [ ] **Step 1: Write UI validation tests**

Create `apps/webapp/src/components/settings/approval-policy-dialog.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { buildApprovalPolicyPayload, defaultApprovalPolicyFormValues } from "./approval-policy-dialog";

describe("approval policy dialog helpers", () => {
	it("builds a valid payload for one sequential stage", () => {
		const payload = buildApprovalPolicyPayload({
			...defaultApprovalPolicyFormValues,
			name: "Absence escalation",
			isActive: true,
			priority: "10",
			approvalTypes: ["absence_entry"],
			stages: [{ localId: "1", label: "Manager", approverType: "direct_manager", approverEmployeeId: "" }],
		});

		expect(payload).toEqual({
			name: "Absence escalation",
			description: "",
			isActive: true,
			priority: 10,
			conditions: [{ conditionType: "approval_type", operator: "in", values: ["absence_entry"] }],
			stages: [{ id: "1", stepOrder: 1, label: "Manager", approverType: "direct_manager" }],
		});
	});

	it("rejects active payloads without stages", () => {
		expect(() =>
			buildApprovalPolicyPayload({
				...defaultApprovalPolicyFormValues,
				name: "Broken",
				isActive: true,
				priority: "1",
				approvalTypes: ["absence_entry"],
				stages: [],
			}),
		).toThrow("Active policies require at least one approval stage.");
	});
});
```

- [ ] **Step 2: Run UI tests and verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/components/settings/approval-policy-dialog.test.tsx`

Expected: FAIL because `approval-policy-dialog.tsx` does not exist.

- [ ] **Step 3: Implement form helpers and dialog skeleton**

Create `apps/webapp/src/components/settings/approval-policy-dialog.tsx` with exported helpers:

```tsx
"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionPanel, ActionPanelBody, ActionPanelContent, ActionPanelFooter, ActionPanelHeader, ActionPanelTitle } from "@/components/ui/action-panel";

export const defaultApprovalPolicyFormValues = {
	name: "",
	description: "",
	isActive: false,
	priority: "10",
	approvalTypes: [] as string[],
	stages: [] as Array<{ localId: string; label: string; approverType: string; approverEmployeeId: string }>,
};

export function buildApprovalPolicyPayload(values: typeof defaultApprovalPolicyFormValues) {
	if (values.isActive && values.stages.length === 0) {
		throw new Error("Active policies require at least one approval stage.");
	}

	return {
		name: values.name.trim(),
		description: values.description.trim(),
		isActive: values.isActive,
		priority: Number(values.priority),
		conditions: values.approvalTypes.length
			? [{ conditionType: "approval_type" as const, operator: "in" as const, values: values.approvalTypes }]
			: [],
		stages: values.stages.map((stage, index) => ({
			id: stage.localId,
			stepOrder: index + 1,
			label: stage.label.trim(),
			approverType: stage.approverType,
			approverEmployeeId: stage.approverEmployeeId || undefined,
		})),
	};
}

interface ApprovalPolicyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (payload: ReturnType<typeof buildApprovalPolicyPayload>) => Promise<void>;
}

export function ApprovalPolicyDialog({ open, onOpenChange, onSubmit }: ApprovalPolicyDialogProps) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: defaultApprovalPolicyFormValues,
		onSubmit: async ({ value }) => onSubmit(buildApprovalPolicyPayload(value)),
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("settings.approvalPolicies.create", "Create Approval Policy")}</ActionPanelTitle>
				</ActionPanelHeader>
				<form onSubmit={(event) => { event.preventDefault(); form.handleSubmit(); }} className="flex min-h-0 flex-1 flex-col">
					<ActionPanelBody className="space-y-4">
						<form.Field name="name">
							{(field) => <Input value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} placeholder={t("settings.approvalPolicies.name", "Policy name")} />}
						</form.Field>
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button type="submit">{t("common.save", "Save")}</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
```

- [ ] **Step 4: Run UI tests and verify helper tests pass**

Run: `pnpm --filter webapp test apps/webapp/src/components/settings/approval-policy-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 5: Add management components**

Create `approval-policy-management.tsx`, `employee-group-management.tsx`, and `approval-policy-preview.tsx` using the same card/list/action-panel pattern as `travel-expense-policy-management.tsx`. The management page must render:

```tsx
<div className="flex flex-1 flex-col gap-4 p-4">
	<div className="flex flex-col gap-2">
		<h1 className="text-2xl font-semibold tracking-tight">Approval Policies</h1>
		<p className="text-sm text-muted-foreground">Configure sequential approval chains by team, location, category, amount, overtime risk, and employee group.</p>
	</div>
	<ApprovalPolicyPreview />
	<EmployeeGroupManagement />
	<Card>{/* active policy table */}</Card>
</div>
```

The policy table columns must be: priority, name, active status, conditions count, stages count, and actions.

- [ ] **Step 6: Add the settings route page**

Create `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/page.tsx`:

```tsx
import { ApprovalPolicyManagement } from "@/components/settings/approval-policy-management";

export default function ApprovalPoliciesSettingsPage() {
	return <ApprovalPolicyManagement />;
}
```

- [ ] **Step 7: Add settings navigation entry and icon**

In `settings-config.ts`, add `"git-branch"` to `SettingsIconName`, then add this entry in the administration group:

```ts
{
	id: "approval-policies",
	titleKey: "settings.approvalPolicies.title",
	titleDefault: "Approval Policies",
	descriptionKey: "settings.approvalPolicies.description",
	descriptionDefault: "Configure sequential approval chains for operational workflows",
	href: "/settings/approval-policies",
	icon: "git-branch",
	minimumTier: "orgAdmin",
	group: "administration",
},
```

In `settings-icons.ts`, map `"git-branch"` to the Tabler icon import used for branch/workflow visuals. If no branch icon is already imported, use `IconGitBranch` from `@tabler/icons-react`.

- [ ] **Step 8: Run settings config tests and UI tests**

Run: `pnpm --filter webapp test apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/components/settings/approval-policy-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit UI work**

```bash
git add "apps/webapp/src/app/[locale]/(app)/settings/approval-policies/page.tsx" apps/webapp/src/components/settings/approval-policy-management.tsx apps/webapp/src/components/settings/approval-policy-dialog.tsx apps/webapp/src/components/settings/employee-group-management.tsx apps/webapp/src/components/settings/approval-policy-preview.tsx apps/webapp/src/components/settings/approval-policy-dialog.test.tsx apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-icons.ts
git commit -m "feat: add approval policy settings UI"
```

## Task 7: Source-Domain Policy Integration

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.ts`
- Test: existing approval tests for those files plus new policy fallback tests.

- [ ] **Step 1: Write fallback and policy-match tests for each source domain**

Add tests named exactly:

```ts
it("uses existing default approval behavior when no approval policy matches", async () => {});
it("creates a chain approval request when an approval policy matches", async () => {});
```

Add them to:

- `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`
- `apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts`
- `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

Expected assertions:

- No policy match inserts the same single `approvalRequest` as before.
- Policy match inserts one `approval_chain_instance`, stage instances, and one current-stage `approvalRequest`.
- All inserts use the requester's `organizationId`.

- [ ] **Step 2: Run source-domain tests and verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/server/absence-approvals.test.ts apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

Expected: FAIL for the new policy-match tests.

- [ ] **Step 3: Add a shared policy evaluation entry point**

Extend `apps/webapp/src/lib/approvals/policies/chain-service.ts` with:

```ts
export interface ResolvePolicyAndCreateApprovalInput {
	context: ApprovalPolicyEvaluationContext;
	defaultApproverId: string;
	reason?: string;
}

export type ResolvePolicyAndCreateApprovalResult =
	| { kind: "default_created"; approvalRequestId: string }
	| { kind: "chain_created"; chainInstanceId: string; approvalRequestId: string };
```

The implementation must:

- Load active policies by `context.organizationId`.
- Load employee groups for `context.requesterEmployeeId` when `context.employeeGroupIds` is empty.
- Find the first matching policy.
- Resolve all stage approvers.
- Create a chain if matched.
- Create the legacy/default `approvalRequest` if no policy matched.

- [ ] **Step 4: Integrate absence approvals**

In absence request creation, build context:

```ts
const policyContext = {
	organizationId: absence.organizationId,
	approvalType: "absence_entry" as const,
	requesterEmployeeId: absence.employeeId,
	teamId: absence.employee.teamId,
	locationId: null,
	absenceCategoryId: absence.categoryId,
	travelExpenseAmount: null,
	overtimeRisk: null,
	employeeGroupIds: [],
	entityType: "absence_entry",
	entityId: absence.id,
};
```

Then call `resolvePolicyAndCreateApproval` instead of directly creating a single request.

- [ ] **Step 5: Integrate travel expense approvals**

In travel expense submission, build context:

```ts
const policyContext = {
	organizationId: claim.organizationId,
	approvalType: "travel_expense_claim" as const,
	requesterEmployeeId: claim.employeeId,
	teamId: claim.employee.teamId,
	locationId: null,
	absenceCategoryId: null,
	travelExpenseAmount: Number(claim.totalAmount),
	overtimeRisk: null,
	employeeGroupIds: [],
	entityType: "travel_expense_claim",
	entityId: claim.id,
};
```

Then call `resolvePolicyAndCreateApproval` instead of directly creating a single request.

- [ ] **Step 6: Integrate overtime-risk approvals**

In the existing time/overtime approval creation path, build context:

```ts
const policyContext = {
	organizationId: currentEmployee.organizationId,
	approvalType: "time_entry" as const,
	requesterEmployeeId: currentEmployee.id,
	teamId: currentEmployee.teamId,
	locationId: null,
	absenceCategoryId: null,
	travelExpenseAmount: null,
	overtimeRisk: detectedOvertimeViolation ? "violation" : detectedOvertimeWarning ? "warning" : "none",
	employeeGroupIds: [],
	entityType: "time_entry",
	entityId: workPeriod.id,
};
```

Use the existing overtime/compliance calculation variables if already present. If the path only has a boolean, map `true` to `warning` unless the violation type is explicitly available.

- [ ] **Step 7: Run source-domain tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/server/absence-approvals.test.ts apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit source integration work**

```bash
git add apps/webapp/src/lib/approvals/policies/chain-service.ts apps/webapp/src/lib/approvals/server/absence-approvals.ts apps/webapp/src/lib/approvals/server/absence-approvals.test.ts apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts "apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.ts"
git commit -m "feat: apply approval policies to requests"
```

## Task 8: Audit Events And Final Verification

**Files:**
- Modify: `apps/webapp/src/lib/approvals/infrastructure/audit-logger.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/chain-service.ts`
- Test: `apps/webapp/src/lib/approvals/policies/chain-service.test.ts`

- [ ] **Step 1: Add audit assertions to chain tests**

Extend `chain-service.test.ts` with tests named:

```ts
it("records chain created and stage request created audit events", async () => {});
it("records stage approved and chain approved audit events", async () => {});
it("records stage rejected and chain rejected audit events", async () => {});
it("records no-match fallback audit events", async () => {});
```

Expected audit event names:

- `approval_policy.matched`
- `approval_policy.no_match_fallback`
- `approval_chain.created`
- `approval_chain.stage_request_created`
- `approval_chain.stage_approved`
- `approval_chain.stage_rejected`
- `approval_chain.approved`
- `approval_chain.rejected`

- [ ] **Step 2: Run audit tests and verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/policies/chain-service.test.ts`

Expected: FAIL because chain audit events are not emitted.

- [ ] **Step 3: Add chain audit logging**

Extend `audit-logger.ts` or add exported helper functions from `chain-service.ts` that log records with this payload shape:

```ts
{
	organizationId: string;
	eventName: string;
	policyId?: string;
	chainId?: string;
	stageId?: string;
	entityType: string;
	entityId: string;
	actorEmployeeId?: string;
	previousStatus?: string;
	newStatus?: string;
	createdAt: Date;
}
```

Add a small `logApprovalPolicyEvent` function in `audit-logger.ts` rather than changing existing decision event names. The function should write through the same audit persistence path used by `ApprovalAuditLogger.log`.

- [ ] **Step 4: Run all targeted tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/approvals/policies/matcher.test.ts apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts apps/webapp/src/lib/approvals/policies/chain-service.test.ts apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts apps/webapp/src/components/settings/approval-policy-dialog.test.tsx apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/lib/approvals/server/absence-approvals.test.ts apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

Expected: PASS.

- [ ] **Step 5: Run quality checks**

Run: `pnpm --filter webapp test`

Expected: PASS.

Run: `pnpm --filter webapp build`

Expected: PASS.

- [ ] **Step 6: Commit audit and verification work**

```bash
git add apps/webapp/src/lib/approvals/infrastructure/audit-logger.ts apps/webapp/src/lib/approvals/policies/chain-service.ts apps/webapp/src/lib/approvals/policies/chain-service.test.ts
git commit -m "feat: audit approval policy chains"
```

## Completion Notes

- Do not edit `apps/webapp/src/db/auth-schema.ts`; it is generated.
- Use Luxon for any new date formatting in UI components.
- Use `@tanstack/react-form` for forms.
- Keep every server action organization-scoped.
- Do not add tenant-specific environment variables for policy behavior.
