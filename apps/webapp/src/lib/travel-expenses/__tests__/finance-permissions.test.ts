import { describe, expect, it } from "vitest";
import { defineAbilityFor, type PrincipalContext } from "@/lib/authorization";
import { isValidPermission } from "@/lib/authorization/permission-registry";
import {
	canExportTravelExpenses,
	canReadTravelExpenseFinance,
	canSettleTravelExpenses,
} from "../finance-permissions";

const ORG = "org-1";

function principal(overrides: Partial<PrincipalContext>): PrincipalContext {
	return {
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: ORG,
		orgMembership: { organizationId: ORG, role: "member", status: "active" },
		employee: { id: "emp-1", organizationId: ORG, role: "employee", teamId: null },
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
		...overrides,
	};
}

function access(context: PrincipalContext, organizationId = ORG) {
	const ability = defineAbilityFor(context);
	return {
		read: canReadTravelExpenseFinance(ability, organizationId, context.activeOrganizationId),
		settle: canSettleTravelExpenses(ability, organizationId, context.activeOrganizationId),
	};
}

describe("travel expense finance permissions (#612)", () => {
	it("grants organization owners and admins finance read and settlement access", () => {
		for (const role of ["owner", "admin"] as const) {
			expect(
				access(principal({ orgMembership: { organizationId: ORG, role, status: "active" } })),
			).toEqual({ read: true, settle: true });
		}
	});

	it("never derives finance access from manager approval authority", () => {
		expect(
			access(
				principal({
					employee: { id: "emp-1", organizationId: ORG, role: "manager", teamId: "team-1" },
					managedEmployeeIds: ["emp-2", "emp-3"],
					permissions: {
						orgWide: {
							canCreateTeams: true,
							canManageTeamMembers: true,
							canManageTeamSettings: true,
							canApproveTeamRequests: true,
						},
						byTeamId: new Map(),
					},
				}),
			),
		).toEqual({ read: false, settle: false });
		expect(access(principal({}))).toEqual({ read: false, settle: false });
	});

	it("never grants finance access through custom roles, which expense officers replace (#748)", () => {
		const context = principal({
			customRoles: [
				{
					roleId: "role-finance",
					roleName: "Accounting",
					baseTier: "employee",
					permissions: (["read", "export", "settle"] as const).map((action) => ({
						action,
						subject: "TravelExpenseFinance",
					})),
				},
			],
		});
		expect(access(context)).toEqual({ read: false, settle: false });
		expect(canExportTravelExpenses(defineAbilityFor(context), ORG, ORG)).toBe(false);
		for (const action of ["read", "export", "settle"]) {
			expect(isValidPermission(action, "TravelExpenseFinance")).toBe(false);
		}
	});

	it("lets owners and admins export in their active organization only (#613)", () => {
		const owner = principal({
			orgMembership: { organizationId: ORG, role: "owner", status: "active" },
		});
		expect(canExportTravelExpenses(defineAbilityFor(owner), ORG, ORG)).toBe(true);
		expect(canExportTravelExpenses(defineAbilityFor(owner), "org-2", ORG)).toBe(false);
	});

	it("is scoped to the active organization", () => {
		const owner = principal({
			orgMembership: { organizationId: ORG, role: "owner", status: "active" },
		});
		expect(access(owner, "org-2")).toEqual({ read: false, settle: false });
		expect(access({ ...owner, activeOrganizationId: null }, ORG)).toEqual({
			read: false,
			settle: false,
		});
	});
});
