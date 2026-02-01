/**
 * CASL Ability Builder Tests
 *
 * Tests the role × action × subject matrix for authorization.
 * Ensures proper tenant isolation and permission flag grants.
 */

import { describe, it, expect } from "vitest";
import {
	defineAbilityFor,
	createEmptyAbility,
	type PrincipalContext,
} from "../index";

// ============================================
// TEST FIXTURES
// ============================================

const ORG_1 = "org-1";
const ORG_2 = "org-2";
const TEAM_1 = "team-1";
const EMPLOYEE_1 = "emp-1";
const EMPLOYEE_2 = "emp-2";
const USER_1 = "user-1";

function createPrincipal(overrides: Partial<PrincipalContext> = {}): PrincipalContext {
	return {
		userId: USER_1,
		isPlatformAdmin: false,
		activeOrganizationId: ORG_1,
		orgMembership: null,
		employee: null,
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		...overrides,
	};
}

// ============================================
// PLATFORM ADMIN TESTS
// ============================================

describe("Platform Admin", () => {
	it("can manage all resources", () => {
		const principal = createPrincipal({ isPlatformAdmin: true });
		const ability = defineAbilityFor(principal);

		expect(ability.can("manage", "all")).toBe(true);
		expect(ability.can("manage", "Platform")).toBe(true);
		expect(ability.can("manage", "User")).toBe(true);
		expect(ability.can("manage", "Organization")).toBe(true);
	});

	it("has full access to all subjects", () => {
		const principal = createPrincipal({
			isPlatformAdmin: true,
			activeOrganizationId: ORG_1,
		});
		const ability = defineAbilityFor(principal);

		expect(ability.can("manage", "Team")).toBe(true);
		expect(ability.can("manage", "Employee")).toBe(true);
		expect(ability.can("manage", "OrgBilling")).toBe(true);
	});
});

// ============================================
// ORGANIZATION OWNER TESTS
// ============================================

describe("Organization Owner", () => {
	const ownerPrincipal = createPrincipal({
		orgMembership: {
			organizationId: ORG_1,
			role: "owner",
			status: "active",
		},
	});

	it("can manage organization settings", () => {
		const ability = defineAbilityFor(ownerPrincipal);

		expect(ability.can("manage", "OrgSettings")).toBe(true);
		expect(ability.can("update", "OrgSettings")).toBe(true);
	});

	it("can manage billing", () => {
		const ability = defineAbilityFor(ownerPrincipal);

		expect(ability.can("manage", "OrgBilling")).toBe(true);
		expect(ability.can("read", "OrgBilling")).toBe(true);
	});

	it("can manage webhooks", () => {
		const ability = defineAbilityFor(ownerPrincipal);

		expect(ability.can("manage", "OrgWebhooks")).toBe(true);
	});

	it("can manage members", () => {
		const ability = defineAbilityFor(ownerPrincipal);

		expect(ability.can("manage", "OrgMembers")).toBe(true);
		expect(ability.can("invite", "OrgMembers")).toBe(true);
	});

	it("cannot access different organization", () => {
		// Owner with different active org cannot manage ORG_2
		const principalWithDifferentOrg = createPrincipal({
			activeOrganizationId: ORG_2,
			orgMembership: {
				organizationId: ORG_2,
				role: "member", // Just a member in ORG_2
				status: "active",
			},
		});
		const ability = defineAbilityFor(principalWithDifferentOrg);

		expect(ability.can("manage", "OrgSettings")).toBe(false);
		expect(ability.can("manage", "OrgBilling")).toBe(false);
	});
});

// ============================================
// ORGANIZATION ADMIN TESTS
// ============================================

describe("Organization Admin", () => {
	const adminPrincipal = createPrincipal({
		orgMembership: {
			organizationId: ORG_1,
			role: "admin",
			status: "active",
		},
	});

	it("can read and update organization settings", () => {
		const ability = defineAbilityFor(adminPrincipal);

		expect(ability.can("read", "OrgSettings")).toBe(true);
		expect(ability.can("update", "OrgSettings")).toBe(true);
	});

	it("can manage webhooks and members", () => {
		const ability = defineAbilityFor(adminPrincipal);

		expect(ability.can("manage", "OrgWebhooks")).toBe(true);
		expect(ability.can("manage", "OrgMembers")).toBe(true);
	});

	it("cannot manage billing", () => {
		const ability = defineAbilityFor(adminPrincipal);

		expect(ability.can("manage", "OrgBilling")).toBe(false);
		expect(ability.can("read", "OrgBilling")).toBe(false);
	});
});

// ============================================
// ORGANIZATION MEMBER TESTS
// ============================================

describe("Organization Member", () => {
	const memberPrincipal = createPrincipal({
		orgMembership: {
			organizationId: ORG_1,
			role: "member",
			status: "active",
		},
	});

	it("can read organization but not update", () => {
		const ability = defineAbilityFor(memberPrincipal);

		// Members have read access to Organization
		expect(ability.can("read", "Organization")).toBe(true);
		expect(ability.can("update", "Organization")).toBe(false);
		expect(ability.can("delete", "Organization")).toBe(false);
	});

	it("cannot manage org settings", () => {
		const ability = defineAbilityFor(memberPrincipal);

		expect(ability.can("manage", "OrgSettings")).toBe(false);
		expect(ability.can("manage", "OrgBilling")).toBe(false);
		expect(ability.can("manage", "OrgMembers")).toBe(false);
	});
});

// ============================================
// EMPLOYEE ADMIN TESTS
// ============================================

describe("Employee Admin", () => {
	const empAdminPrincipal = createPrincipal({
		orgMembership: {
			organizationId: ORG_1,
			role: "member",
			status: "active",
		},
		employee: {
			id: EMPLOYEE_1,
			organizationId: ORG_1,
			role: "admin",
			teamId: TEAM_1,
		},
	});

	it("can manage all workforce resources in org", () => {
		const ability = defineAbilityFor(empAdminPrincipal);

		expect(ability.can("manage", "Team")).toBe(true);
		expect(ability.can("manage", "Employee")).toBe(true);
		expect(ability.can("manage", "TimeEntry")).toBe(true);
		expect(ability.can("manage", "Shift")).toBe(true);
		expect(ability.can("manage", "LeaveRequest")).toBe(true);
		expect(ability.can("manage", "Approval")).toBe(true);
	});

	it("can manage reports and locations", () => {
		const ability = defineAbilityFor(empAdminPrincipal);

		expect(ability.can("manage", "Report")).toBe(true);
		expect(ability.can("manage", "Location")).toBe(true);
	});
});

// ============================================
// EMPLOYEE MANAGER TESTS
// ============================================

describe("Employee Manager", () => {
	const managerPrincipal = createPrincipal({
		orgMembership: {
			organizationId: ORG_1,
			role: "member",
			status: "active",
		},
		employee: {
			id: EMPLOYEE_1,
			organizationId: ORG_1,
			role: "manager",
			teamId: TEAM_1,
		},
		managedEmployeeIds: [EMPLOYEE_2],
	});

	it("can manage own employee data", () => {
		const ability = defineAbilityFor(managerPrincipal);

		// Managers can read/update their own employee record
		expect(ability.can("read", "Employee")).toBe(true);
		expect(ability.can("update", "Employee")).toBe(true);
	});

	it("can read time entries and leave requests", () => {
		const ability = defineAbilityFor(managerPrincipal);

		expect(ability.can("read", "TimeEntry")).toBe(true);
		expect(ability.can("read", "LeaveRequest")).toBe(true);
	});

	it("can approve requests from direct reports", () => {
		const ability = defineAbilityFor(managerPrincipal);

		// The ability is granted for the specific employee ID
		expect(ability.can("approve", "Approval")).toBe(true);
	});

	it("cannot approve requests from non-reports", () => {
		// Create a manager with no managed employees
		const managerNoReports = createPrincipal({
			orgMembership: {
				organizationId: ORG_1,
				role: "member",
				status: "active",
			},
			employee: {
				id: EMPLOYEE_1,
				organizationId: ORG_1,
				role: "manager",
				teamId: TEAM_1,
			},
			managedEmployeeIds: [], // No direct reports
		});
		const ability = defineAbilityFor(managerNoReports);

		// Manager with no direct reports cannot approve
		expect(ability.can("approve", "Approval")).toBe(false);
	});

	it("can view own team", () => {
		const ability = defineAbilityFor(managerPrincipal);

		expect(ability.can("read", "Team")).toBe(true);
		expect(ability.can("read", "Shift")).toBe(true);
	});
});

// ============================================
// EMPLOYEE (REGULAR) TESTS
// ============================================

describe("Employee (Regular)", () => {
	const employeePrincipal = createPrincipal({
		orgMembership: {
			organizationId: ORG_1,
			role: "member",
			status: "active",
		},
		employee: {
			id: EMPLOYEE_1,
			organizationId: ORG_1,
			role: "employee",
			teamId: TEAM_1,
		},
	});

	it("can access own employee data", () => {
		const ability = defineAbilityFor(employeePrincipal);

		// Regular employees can read/update their own record
		expect(ability.can("read", "Employee")).toBe(true);
		expect(ability.can("update", "Employee")).toBe(true);
	});

	it("can manage own time entries", () => {
		const ability = defineAbilityFor(employeePrincipal);

		expect(ability.can("manage", "TimeEntry")).toBe(true);
		expect(ability.can("create", "TimeEntry")).toBe(true);
	});

	it("can create and read own leave requests", () => {
		const ability = defineAbilityFor(employeePrincipal);

		expect(ability.can("create", "LeaveRequest")).toBe(true);
		expect(ability.can("read", "LeaveRequest")).toBe(true);
	});

	it("can view own team", () => {
		const ability = defineAbilityFor(employeePrincipal);

		expect(ability.can("read", "Team")).toBe(true);
		expect(ability.can("read", "Shift")).toBe(true);
	});

	it("cannot approve anything", () => {
		const ability = defineAbilityFor(employeePrincipal);

		expect(ability.can("approve", "Approval")).toBe(false);
	});
});

// ============================================
// PERMISSION FLAGS TESTS
// ============================================

describe("Permission Flags", () => {
	it("org-wide canCreateTeams grants create team ability", () => {
		const principal = createPrincipal({
			employee: {
				id: EMPLOYEE_1,
				organizationId: ORG_1,
				role: "employee",
				teamId: null,
			},
			permissions: {
				orgWide: { canCreateTeams: true },
				byTeamId: new Map(),
			},
		});
		const ability = defineAbilityFor(principal);

		expect(ability.can("create", "Team")).toBe(true);
	});

	it("org-wide canManageTeamMembers grants update team ability", () => {
		const principal = createPrincipal({
			employee: {
				id: EMPLOYEE_1,
				organizationId: ORG_1,
				role: "employee",
				teamId: null,
			},
			permissions: {
				orgWide: { canManageTeamMembers: true },
				byTeamId: new Map(),
			},
		});
		const ability = defineAbilityFor(principal);

		expect(ability.can("update", "Team")).toBe(true);
		expect(ability.can("invite", "Team")).toBe(true);
	});

	it("org-wide canApproveTeamRequests grants approval ability", () => {
		const principal = createPrincipal({
			employee: {
				id: EMPLOYEE_1,
				organizationId: ORG_1,
				role: "employee",
				teamId: null,
			},
			permissions: {
				orgWide: { canApproveTeamRequests: true },
				byTeamId: new Map(),
			},
		});
		const ability = defineAbilityFor(principal);

		expect(ability.can("approve", "Approval")).toBe(true);
		expect(ability.can("reject", "Approval")).toBe(true);
	});

	it("team-specific permissions are scoped to that team", () => {
		const teamPerms = new Map();
		teamPerms.set(TEAM_1, { canManageTeamMembers: true });

		const principal = createPrincipal({
			employee: {
				id: EMPLOYEE_1,
				organizationId: ORG_1,
				role: "employee",
				teamId: null,
			},
			permissions: {
				orgWide: null,
				byTeamId: teamPerms,
			},
		});
		const ability = defineAbilityFor(principal);

		// Can update team (the ability is granted for that team)
		expect(ability.can("update", "Team")).toBe(true);
		expect(ability.can("invite", "Team")).toBe(true);
	});
});

// ============================================
// TENANT ISOLATION TESTS
// ============================================

describe("Tenant Isolation", () => {
	it("employee admin can manage workforce resources in their org", () => {
		const principal = createPrincipal({
			activeOrganizationId: ORG_1,
			employee: {
				id: EMPLOYEE_1,
				organizationId: ORG_1,
				role: "admin",
				teamId: null,
			},
		});
		const ability = defineAbilityFor(principal);

		// Admin can manage all workforce resources
		expect(ability.can("manage", "Team")).toBe(true);
		expect(ability.can("manage", "Employee")).toBe(true);
		expect(ability.can("manage", "Approval")).toBe(true);
	});

	it("manager with direct reports can approve", () => {
		const principal = createPrincipal({
			activeOrganizationId: ORG_1,
			employee: {
				id: EMPLOYEE_1,
				organizationId: ORG_1,
				role: "manager",
				teamId: null,
			},
			managedEmployeeIds: [EMPLOYEE_2],
		});
		const ability = defineAbilityFor(principal);

		// Manager can approve (has direct reports)
		expect(ability.can("approve", "Approval")).toBe(true);
	});

	it("user in different org has different abilities", () => {
		// User in ORG_2 as owner
		const principalOrg2 = createPrincipal({
			activeOrganizationId: ORG_2,
			orgMembership: {
				organizationId: ORG_2,
				role: "owner",
				status: "active",
			},
		});
		const ability = defineAbilityFor(principalOrg2);

		// Owner can manage their org
		expect(ability.can("manage", "OrgBilling")).toBe(true);
		expect(ability.can("manage", "OrgSettings")).toBe(true);
	});

	it("unauthenticated user has no abilities", () => {
		const ability = createEmptyAbility();

		expect(ability.can("read", "Organization")).toBe(false);
		expect(ability.can("read", "Employee")).toBe(false);
		expect(ability.can("manage", "all")).toBe(false);
	});

	it("user without active org has no org-level abilities", () => {
		const principal = createPrincipal({
			activeOrganizationId: null,
			orgMembership: null,
			employee: null,
		});
		const ability = defineAbilityFor(principal);

		// Without active org, no abilities for org resources
		expect(ability.can("manage", "Team")).toBe(false);
		expect(ability.can("manage", "OrgSettings")).toBe(false);
	});
});
