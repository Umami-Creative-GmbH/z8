import type {
	SCIMProjectedUserState,
	SCIMRoleExistenceInput,
	SCIMRoleMappingInput,
	SCIMTransactionContext,
} from "@better-auth/scim";
import { describe, expect, it } from "vitest";
import {
	reconcileSCIMRoleProjection,
	scimRoleProjection,
} from "./projection-reconciler";
import { SCIM_MODELS } from "./transaction-store";
import { createTransactionFixture } from "./transaction-store.test-fixture";

const organizationId = "org_target";
const userId = "user_opaque";
const connectionId = "connection_opaque";

function context(
	target: ReturnType<typeof createTransactionFixture>,
): SCIMTransactionContext {
	return { database: target.database };
}

function baseRows(extra: Record<string, Record<string, unknown>[]> = {}) {
	return {
		[SCIM_MODELS.providerConfig]: [
			{
				id: "config_1",
				organizationId,
				connectionId,
				state: "active",
				defaultRoleTemplateId: "template_default",
			},
		],
		[SCIM_MODELS.member]: [
			{ id: "member_1", organizationId, userId, status: "approved" },
		],
		[SCIM_MODELS.employee]: [
			{
				id: "employee_1",
				organizationId,
				userId,
				role: "employee",
				isActive: true,
			},
		],
		[SCIM_MODELS.roleTemplate]: [
			{
				id: "template_default",
				organizationId,
				isGlobal: false,
				isActive: true,
				employeeRole: "employee",
				teamPermissions: {},
				defaultTeamId: null,
			},
		],
		...extra,
	};
}

function group(externalId: string | undefined, displayName = "Administrators") {
	return {
		type: "group" as const,
		id: `group_${displayName}`,
		externalId,
		displayName,
	};
}

function mappingInput(source = group("external_group")): SCIMRoleMappingInput {
	return {
		connectionId,
		provisioningDomainId: organizationId,
		scimUserId: "scim_user",
		userId,
		source,
	};
}

function existsInput(role: string): SCIMRoleExistenceInput {
	return { connectionId, provisioningDomainId: organizationId, role };
}

function projected(
	grants: SCIMProjectedUserState["grants"],
): SCIMProjectedUserState {
	return {
		provisioningDomainId: organizationId,
		userId,
		active: true,
		sources: [
			{
				id: "source_1",
				connectionId,
				provisioningDomainId: organizationId,
				active: true,
			},
		],
		grants,
	};
}

describe("SCIM role mapping", () => {
	it("maps only a nonempty external group ID using exact organization and SCIM type", async () => {
		const target = createTransactionFixture(
			baseRows({
				[SCIM_MODELS.roleMapping]: [
					{
						id: "mapping_1",
						organizationId,
						idpType: "scim",
						idpGroupId: "external_group",
						roleTemplateId: "template_default",
						priority: 1,
					},
				],
			}),
		);

		await expect(
			scimRoleProjection.map(mappingInput(), context(target)),
		).resolves.toEqual(["template_default"]);
		await expect(
			scimRoleProjection.map(
				mappingInput(group("", "external_group")),
				context(target),
			),
		).resolves.toBeUndefined();
		expect(target.operations.findOne).toHaveBeenCalledWith({
			model: SCIM_MODELS.roleMapping,
			where: [
				{ field: "organizationId", value: organizationId },
				{ field: "idpType", value: "scim" },
				{ field: "idpGroupId", value: "external_group" },
			],
		});
	});

	it("accepts only active local or explicitly global templates", async () => {
		const target = createTransactionFixture(
			baseRows({
				[SCIM_MODELS.roleTemplate]: [
					{ id: "local", organizationId, isGlobal: false, isActive: true },
					{
						id: "global",
						organizationId: null,
						isGlobal: true,
						isActive: true,
					},
					{
						id: "foreign",
						organizationId: "org_foreign",
						isGlobal: false,
						isActive: true,
					},
					{ id: "inactive", organizationId, isGlobal: false, isActive: false },
					{
						id: "fake_global",
						organizationId: null,
						isGlobal: false,
						isActive: true,
					},
				],
			}),
		);

		await expect(
			scimRoleProjection.exists(existsInput("local"), context(target)),
		).resolves.toBe(true);
		await expect(
			scimRoleProjection.exists(existsInput("global"), context(target)),
		).resolves.toBe(true);
		for (const role of ["foreign", "inactive", "fake_global"]) {
			await expect(
				scimRoleProjection.exists(existsInput(role), context(target)),
			).resolves.toBe(false);
		}
	});
});

describe("reconcileSCIMRoleProjection", () => {
	it("chooses priority descending then mapping ID ascending and persists the desired source", async () => {
		const sourceA = group("group_a", "Same name");
		const sourceB = group("group_b", "Same name");
		const target = createTransactionFixture(
			baseRows({
				[SCIM_MODELS.roleMapping]: [
					{
						id: "mapping_b",
						organizationId,
						idpType: "scim",
						idpGroupId: "group_a",
						roleTemplateId: "template_b",
						priority: 10,
					},
					{
						id: "mapping_a",
						organizationId,
						idpType: "scim",
						idpGroupId: "group_b",
						roleTemplateId: "template_a",
						priority: 10,
					},
				],
				[SCIM_MODELS.roleTemplate]: [
					{
						id: "template_default",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "employee",
						teamPermissions: {},
						defaultTeamId: null,
					},
					{
						id: "template_a",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "admin",
						teamPermissions: { canCreateTeams: true },
						defaultTeamId: "team_a",
					},
					{
						id: "template_b",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "manager",
						teamPermissions: {},
						defaultTeamId: null,
					},
				],
			}),
		);

		await reconcileSCIMRoleProjection(
			projected([
				{ source: sourceA, role: "template_b" },
				{ source: sourceB, role: "template_a" },
			]),
			context(target),
		);

		expect(target.rows(SCIM_MODELS.projectionState)).toMatchObject([
			{
				organizationId,
				userId,
				roleTemplateId: "template_a",
				sourceGroupId: "group_b",
			},
		]);
		expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
			role: "admin",
		});
		expect(target.rows(SCIM_MODELS.teamPermission)[0]).toMatchObject({
			organizationId,
			employeeId: "employee_1",
			teamId: null,
			canCreateTeams: true,
			canManageTeamMembers: false,
		});
		expect(target.rows(SCIM_MODELS.teamMembership)).toMatchObject([
			{ organizationId, employeeId: "employee_1", teamId: "team_a" },
		]);
		expect(target.rows(SCIM_MODELS.roleAssignment)[0]).toMatchObject({
			organizationId,
			userId,
			roleTemplateId: "template_a",
			assignmentSource: "scim",
		});
	});

	it("falls back to the mandatory default when groups are removed", async () => {
		const target = createTransactionFixture(
			baseRows({
				[SCIM_MODELS.roleTemplate]: [
					{
						id: "template_default",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "employee",
						teamPermissions: {},
						defaultTeamId: null,
					},
					{
						id: "template_old",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "admin",
						teamPermissions: { canCreateTeams: true },
						defaultTeamId: "team_old",
					},
				],
				[SCIM_MODELS.projectionState]: [
					{
						id: "projection_1",
						organizationId,
						userId,
						roleTemplateId: "template_old",
						sourceGroupId: "old_group",
						appliedRoleTemplateId: "template_old",
						appliedDefaultTeamId: "team_old",
						appliedDefaultTeamMembershipOwned: true,
					},
				],
				[SCIM_MODELS.roleAssignment]: [
					{
						id: "assignment_1",
						organizationId,
						userId,
						roleTemplateId: "template_old",
						assignmentSource: "scim",
						idpGroupId: "old_group",
					},
				],
				[SCIM_MODELS.teamPermission]: [
					{
						id: "permission_1",
						organizationId,
						employeeId: "employee_1",
						teamId: null,
						canCreateTeams: true,
					},
				],
				[SCIM_MODELS.teamMembership]: [
					{
						id: "membership_1",
						organizationId,
						employeeId: "employee_1",
						teamId: "team_old",
					},
				],
			}),
		);

		await reconcileSCIMRoleProjection(projected([]), context(target));

		expect(target.rows(SCIM_MODELS.projectionState)[0]).toMatchObject({
			roleTemplateId: "template_default",
			sourceGroupId: null,
		});
		expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
			role: "employee",
		});
		expect(target.rows(SCIM_MODELS.teamPermission)[0]).toMatchObject({
			canCreateTeams: false,
		});
		expect(target.rows(SCIM_MODELS.teamMembership)).toHaveLength(0);
	});

	it("does not infer default-team ownership from a SCIM assignment", async () => {
		const target = createTransactionFixture(
			baseRows({
				[SCIM_MODELS.roleTemplate]: [
					{
						id: "template_default",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "employee",
						teamPermissions: {},
						defaultTeamId: null,
					},
					{
						id: "template_old",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "admin",
						teamPermissions: {},
						defaultTeamId: "team_old",
					},
				],
				[SCIM_MODELS.roleAssignment]: [
					{
						id: "assignment_1",
						organizationId,
						userId,
						roleTemplateId: "template_old",
						assignmentSource: "scim",
					},
				],
				[SCIM_MODELS.teamMembership]: [
					{
						id: "membership_1",
						organizationId,
						employeeId: "employee_1",
						teamId: "team_old",
					},
				],
			}),
		);

		await reconcileSCIMRoleProjection(projected([]), context(target));

		expect(target.rows(SCIM_MODELS.teamMembership)).toHaveLength(1);
	});

	it("tracks desired state through an override then replaces only the last SCIM-owned team", async () => {
		const target = createTransactionFixture(
			baseRows({
				[SCIM_MODELS.roleMapping]: [
					{
						id: "mapping_a",
						organizationId,
						idpType: "scim",
						idpGroupId: "group_a",
						roleTemplateId: "template_a",
						priority: 1,
					},
					{
						id: "mapping_b",
						organizationId,
						idpType: "scim",
						idpGroupId: "group_b",
						roleTemplateId: "template_b",
						priority: 1,
					},
				],
				[SCIM_MODELS.roleTemplate]: [
					{
						id: "template_default",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "employee",
						teamPermissions: {},
						defaultTeamId: null,
					},
					{
						id: "template_a",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "manager",
						teamPermissions: {},
						defaultTeamId: "team_a",
					},
					{
						id: "template_b",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "admin",
						teamPermissions: {},
						defaultTeamId: "team_b",
					},
				],
			}),
		);
		const sourceA = group("group_a", "Group A");
		const sourceB = group("group_b", "Group B");

		await reconcileSCIMRoleProjection(
			projected([{ source: sourceA, role: "template_a" }]),
			context(target),
		);
		const assignment = target.rows(SCIM_MODELS.roleAssignment)[0];
		if (!assignment) throw new Error("Expected the SCIM assignment");
		Object.assign(assignment, {
			roleTemplateId: "template_manual",
			assignmentSource: "manual",
		});
		await reconcileSCIMRoleProjection(
			projected([{ source: sourceB, role: "template_b" }]),
			context(target),
		);

		expect(target.rows(SCIM_MODELS.projectionState)[0]).toMatchObject({
			roleTemplateId: "template_b",
			appliedRoleTemplateId: "template_a",
			appliedDefaultTeamId: "team_a",
			appliedDefaultTeamMembershipOwned: true,
		});
		expect(target.rows(SCIM_MODELS.teamMembership)).toMatchObject([
			{ teamId: "team_a" },
		]);

		target.rows(SCIM_MODELS.roleAssignment).splice(0, 1);
		await reconcileSCIMRoleProjection(
			projected([{ source: sourceB, role: "template_b" }]),
			context(target),
		);

		expect(target.rows(SCIM_MODELS.teamMembership)).toMatchObject([
			{ teamId: "team_b" },
		]);
		expect(target.rows(SCIM_MODELS.projectionState)[0]).toMatchObject({
			roleTemplateId: "template_b",
			appliedRoleTemplateId: "template_b",
			appliedDefaultTeamId: "team_b",
			appliedDefaultTeamMembershipOwned: true,
		});
	});

	it("never deletes a preexisting manual default-team membership", async () => {
		const target = createTransactionFixture(
			baseRows({
				[SCIM_MODELS.roleMapping]: [
					{
						id: "mapping_a",
						organizationId,
						idpType: "scim",
						idpGroupId: "group_a",
						roleTemplateId: "template_a",
						priority: 1,
					},
					{
						id: "mapping_b",
						organizationId,
						idpType: "scim",
						idpGroupId: "group_b",
						roleTemplateId: "template_b",
						priority: 1,
					},
				],
				[SCIM_MODELS.roleTemplate]: [
					{
						id: "template_default",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "employee",
						teamPermissions: {},
						defaultTeamId: null,
					},
					{
						id: "template_a",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "manager",
						teamPermissions: {},
						defaultTeamId: "team_a",
					},
					{
						id: "template_b",
						organizationId,
						isGlobal: false,
						isActive: true,
						employeeRole: "admin",
						teamPermissions: {},
						defaultTeamId: "team_b",
					},
				],
				[SCIM_MODELS.teamMembership]: [
					{
						id: "manual_membership",
						organizationId,
						employeeId: "employee_1",
						teamId: "team_a",
						createdBy: "admin_opaque",
					},
				],
			}),
		);
		const sourceA = group("group_a", "Group A");
		const sourceB = group("group_b", "Group B");

		await reconcileSCIMRoleProjection(
			projected([{ source: sourceA, role: "template_a" }]),
			context(target),
		);
		expect(target.rows(SCIM_MODELS.projectionState)[0]).toMatchObject({
			appliedDefaultTeamId: "team_a",
			appliedDefaultTeamMembershipOwned: false,
		});
		await reconcileSCIMRoleProjection(
			projected([{ source: sourceB, role: "template_b" }]),
			context(target),
		);

		expect(target.rows(SCIM_MODELS.teamMembership)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "manual_membership", teamId: "team_a" }),
				expect.objectContaining({ teamId: "team_b" }),
			]),
		);
	});

	it.each(["manual", "invite_code", "sso"] as const)(
		"persists desired projection but never overwrites a %s assignment",
		async (assignmentSource) => {
			const target = createTransactionFixture(
				baseRows({
					[SCIM_MODELS.roleAssignment]: [
						{
							id: "assignment_1",
							organizationId,
							userId,
							roleTemplateId: "template_manual",
							assignmentSource,
						},
					],
				}),
			);

			await reconcileSCIMRoleProjection(projected([]), context(target));

			expect(target.rows(SCIM_MODELS.projectionState)[0]).toMatchObject({
				roleTemplateId: "template_default",
			});
			expect(target.rows(SCIM_MODELS.roleAssignment)[0]).toMatchObject({
				roleTemplateId: "template_manual",
				assignmentSource,
			});
			expect(target.rows(SCIM_MODELS.employee)[0]).toMatchObject({
				role: "employee",
			});
			expect(
				target.operations.update.mock.calls.some(
					([query]) => query.model === SCIM_MODELS.user,
				),
			).toBe(false);
		},
	);

	it("rejects a foreign or inactive default template", async () => {
		for (const invalid of [
			{ organizationId: "org_foreign", isGlobal: false, isActive: true },
			{ organizationId, isGlobal: false, isActive: false },
		]) {
			const target = createTransactionFixture(
				baseRows({
					[SCIM_MODELS.roleTemplate]: [{ id: "template_default", ...invalid }],
				}),
			);
			await expect(
				reconcileSCIMRoleProjection(projected([]), context(target)),
			).rejects.toThrow("SCIM role template is unavailable");
		}
	});
});
