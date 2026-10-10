import { describe, expect, it } from "vitest";
import { defineAbilityFor } from "@/lib/authorization/ability";
import type { PrincipalContext } from "@/lib/authorization/types";
import { canCloseMonths, canReopenMonths } from "./permissions";

const ORG = "org-1";

function principal(overrides: Partial<PrincipalContext> = {}): PrincipalContext {
	return {
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: ORG,
		orgMembership: null,
		employee: { id: "emp-1", organizationId: ORG, role: "employee", teamId: null },
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
		...overrides,
	};
}

function member(role: "owner" | "admin" | "member") {
	return principal({ orgMembership: { organizationId: ORG, role, status: "approved" } });
}

describe("closed month permissions", () => {
	it("lets owners close and reopen", () => {
		const ability = defineAbilityFor(member("owner"));

		expect(canCloseMonths(ability, ORG, ORG)).toBe(true);
		expect(canReopenMonths(ability, ORG, ORG)).toBe(true);
	});

	it("lets admins close but not reopen by default", () => {
		const ability = defineAbilityFor(member("admin"));

		expect(canCloseMonths(ability, ORG, ORG)).toBe(true);
		expect(canReopenMonths(ability, ORG, ORG)).toBe(false);
	});

	it("lets members do neither", () => {
		const ability = defineAbilityFor(member("member"));

		expect(canCloseMonths(ability, ORG, ORG)).toBe(false);
		expect(canReopenMonths(ability, ORG, ORG)).toBe(false);
	});

	it("grants reopening through a custom role without closing", () => {
		const ability = defineAbilityFor(
			principal({
				customRoles: [
					{
						roleId: "role-1",
						roleName: "Payroll lead",
						baseTier: "employee",
						permissions: [{ action: "reopen", subject: "PayrollPeriod" }],
					},
				],
			}),
		);

		expect(canReopenMonths(ability, ORG, ORG)).toBe(true);
		expect(canCloseMonths(ability, ORG, ORG)).toBe(false);
	});

	it("refuses another organization than the active one", () => {
		const ability = defineAbilityFor(member("owner"));

		expect(canCloseMonths(ability, "org-2", ORG)).toBe(false);
	});
});
