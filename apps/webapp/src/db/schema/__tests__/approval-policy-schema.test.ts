import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	approvalPolicy,
	approvalPolicyCondition,
	approvalPolicyStage,
	absenceCategory,
	employee,
	employeeGroup,
	employeeGroupMember,
	location,
	organizationRelations,
	team,
	teamMembership,
} from "@/db/schema";

function uniqueIndexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
	const config = getTableConfig(table);

	return [
		...config.indexes.filter((index) => index.config.unique).map((index) => index.config.name),
		...config.uniqueConstraints.map((constraint) => constraint.getName()),
	];
}

function hasCompositeForeignKey(
	table: Parameters<typeof getTableConfig>[0],
	columns: string[],
	foreignTable: Parameters<typeof getTableConfig>[0],
	foreignColumns: string[],
): boolean {
	return getTableConfig(table).foreignKeys.some((foreignKey) => {
		const reference = foreignKey.reference();

		return (
			reference.columns.map((column) => column.name).join(",") === columns.join(",") &&
			reference.foreignColumns.map((column) => column.name).join(",") ===
				foreignColumns.join(",") &&
			reference.foreignColumns.every((column) => column.table === foreignTable)
		);
	});
}

function organizationRelationKeys(): string[] {
	const relation = { withFieldName: (fieldName: string) => fieldName };
	const relations = organizationRelations.config({
		one: () => relation,
		many: () => relation,
	});

	return Object.keys(relations);
}

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

	it("defines parent uniqueness for org-scoped composite foreign keys", () => {
		expect(uniqueIndexNames(approvalPolicy)).toEqual(
			expect.arrayContaining(["approvalPolicy_id_organizationId_idx"]),
		);
		expect(uniqueIndexNames(employeeGroup)).toEqual(
			expect.arrayContaining(["employeeGroup_id_organizationId_idx"]),
		);
		expect(uniqueIndexNames(approvalChainInstance)).toEqual(
			expect.arrayContaining(["approvalChainInstance_id_organizationId_idx"]),
		);
		expect(uniqueIndexNames(approvalPolicyStage)).toEqual(
			expect.arrayContaining(["approvalPolicyStage_id_organizationId_idx"]),
		);
		expect(uniqueIndexNames(approvalRequest)).toEqual(
			expect.arrayContaining(["approvalRequest_id_organizationId_idx"]),
		);
		expect(uniqueIndexNames(team)).toEqual(
			expect.arrayContaining(["team_id_organizationId_idx"]),
		);
		expect(uniqueIndexNames(location)).toEqual(
			expect.arrayContaining(["location_id_organizationId_idx"]),
		);
		expect(uniqueIndexNames(absenceCategory)).toEqual(
			expect.arrayContaining(["absenceCategory_id_organizationId_idx"]),
		);
		expect(uniqueIndexNames(employee)).toEqual(
			expect.arrayContaining(["employee_id_organizationId_idx"]),
		);
	});

	it("uses org-scoped composite foreign keys for approval policy runtime links", () => {
		expect(approvalPolicyCondition.employeeGroupId.name).toBe("employee_group_id");
		expect(
			hasCompositeForeignKey(approvalPolicyCondition, ["policy_id", "organization_id"], approvalPolicy, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(approvalPolicyStage, ["policy_id", "organization_id"], approvalPolicy, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(employeeGroupMember, ["group_id", "organization_id"], employeeGroup, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(approvalPolicyCondition, ["team_id", "organization_id"], team, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(approvalPolicyCondition, ["location_id", "organization_id"], location, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				approvalPolicyCondition,
				["absence_category_id", "organization_id"],
				absenceCategory,
				["id", "organization_id"],
			),
		).toBe(true);
		expect(
			hasCompositeForeignKey(approvalPolicyCondition, ["employee_group_id", "organization_id"], employeeGroup, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(approvalPolicyStage, ["approver_employee_id", "organization_id"], employee, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(employeeGroupMember, ["employee_id", "organization_id"], employee, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(approvalChainInstance, ["policy_id", "organization_id"], approvalPolicy, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(approvalChainInstance, ["requester_employee_id", "organization_id"], employee, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				approvalChainStageInstance,
				["chain_instance_id", "organization_id"],
				approvalChainInstance,
				["id", "organization_id"],
			),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				approvalChainStageInstance,
				["policy_stage_id", "organization_id"],
				approvalPolicyStage,
				["id", "organization_id"],
			),
		).toBe(false);
		expect(
			hasCompositeForeignKey(
				approvalChainStageInstance,
				["approval_request_id", "organization_id"],
				approvalRequest,
				["id", "organization_id"],
			),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				approvalChainStageInstance,
				["resolved_approver_employee_id", "organization_id"],
				employee,
				["id", "organization_id"],
			),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				approvalChainStageInstance,
				["decided_by", "organization_id"],
				employee,
				["id", "organization_id"],
			),
		).toBe(true);
	});

	it("exposes organization relations for all approval policy tables", () => {
		expect(organizationRelationKeys()).toEqual(
			expect.arrayContaining([
				"approvalPolicies",
				"approvalPolicyConditions",
				"approvalPolicyStages",
				"employeeGroups",
				"employeeGroupMembers",
				"approvalChainInstances",
				"approvalChainStageInstances",
			]),
		);
	});

	it("defines team membership and primary team manager schema", () => {
		expect(team.primaryManagerId.name).toBe("primary_manager_id");
		expect(teamMembership).toBeDefined();
		expect(teamMembership.organizationId.notNull).toBe(true);
		expect(teamMembership.teamId.notNull).toBe(true);
		expect(teamMembership.employeeId.notNull).toBe(true);
		expect(teamMembership.createdBy.notNull).toBe(false);
		expect(uniqueIndexNames(teamMembership)).toEqual(
			expect.arrayContaining(["teamMembership_team_employee_idx"]),
		);
		expect(
			hasCompositeForeignKey(team, ["primary_manager_id", "organization_id"], employee, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(teamMembership, ["team_id", "organization_id"], team, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(teamMembership, ["employee_id", "organization_id"], employee, [
				"id",
				"organization_id",
			]),
		).toBe(true);
	});

	it("keeps team organization id when deleting a primary manager", () => {
		const migration = readFileSync("drizzle/0013_team_membership_primary_manager.sql", "utf8");

		expect(migration).toContain('ON DELETE SET NULL ("primary_manager_id")');
	});

	it("guards team membership backfill by organization", () => {
		const migration = readFileSync("drizzle/0013_team_membership_primary_manager.sql", "utf8");

		expect(migration).toContain('JOIN "team" ON "team"."id" = "employee"."team_id"');
		expect(migration).toContain(
			'AND "team"."organization_id" = "employee"."organization_id"',
		);
	});
});
