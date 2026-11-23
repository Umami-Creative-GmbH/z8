/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AppAbility,
	createEmptyAbility,
	defineAbilityFor,
	type PrincipalContext,
} from "@/lib/authorization";

const mockState = vi.hoisted(() => ({
	settingsAccess: "member" as "member" | "scopedManager" | "orgAdmin" | "owner" | null,
	employee: null as { id: string; organizationId: string; role: "admin" | "manager" | "employee" } | null,
	hasGrant: false,
	canClose: false,
	canReopen: false,
	/** The member ability the request carries; null keeps the payroll-only stub. */
	ability: null as AppAbility | null,
	appSidebarSpy: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/env", () => ({ env: { BILLING_ENABLED: "false" } }));
vi.mock("@/lib/auth/render-context", () => ({
	getRenderAuthContext: vi.fn(async () => ({
		user: { id: "user-1", role: "user", canCreateOrganizations: false },
		session: { activeOrganizationId: "org-1" },
		employee: mockState.employee,
	})),
	getRenderSettingsAccess: vi.fn(async () => mockState.settingsAccess),
	getRenderUserOrganizations: vi.fn(async () => [
		{
			id: "org-1",
			name: "Acme",
			slug: "acme",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: false,
			worksCouncilEnabled: false,
			billableTimeEnabled: false,
			personnelFilesEnabled: false,
			equipmentEnabled: false,
		},
	]),
	getRenderOrganizationIdentity: vi.fn(async () => ({
		organizationId: "org-1",
		userId: "user-1",
		employee: mockState.employee,
	})),
	getRenderAbility: vi.fn(
		async () =>
			mockState.ability ?? {
				can: (action: string, subject: string) => {
					if (subject !== "PayrollPeriod") return false;
					if (action === "close") return mockState.canClose;
					if (action === "reopen") return mockState.canReopen;
					return false;
				},
				cannot: () => true,
			},
	),
	getRenderOrganizationAbility: vi.fn(async () => ({
		can: (action: string, subject: string) => {
			if (subject !== "PayrollPeriod") return false;
			if (action === "close") return mockState.canClose;
			if (action === "reopen") return mockState.canReopen;
			return false;
		},
	})),
}));
vi.mock("@/lib/projects/project-task-permission", () => ({
	hasTaskManagedProject: vi.fn(async () => false),
}));
vi.mock("@/lib/projects/report-share/report-share-links", () => ({
	hasActiveOrganizationShareLinks: vi.fn(async () => false),
}));
vi.mock("@/lib/organization/creation-policy.server", () => ({
	canCreateOrganizationsForDeployment: () => false,
}));
vi.mock("@/lib/organization/driving-licence/visibility", () => ({
	readDrivingLicenceVisibilityForIdentity: vi.fn(async () => ({
		myDrivingLicence: false,
		teamDrivingLicence: false,
		settings: false,
	})),
}));
vi.mock("@/lib/organization/driving-licence/visibility-rules", () => ({
	HIDDEN_DRIVING_LICENCE_VISIBILITY: {
		myDrivingLicence: false,
		teamDrivingLicence: false,
		settings: false,
	},
	showsDrivingLicenceSettings: () => false,
	showsMyDrivingLicence: () => false,
	showsTeamDrivingLicence: () => false,
}));
vi.mock("@/lib/organization/equipment/access", () => ({
	readEquipmentNavigation: vi.fn(async () => ({ personal: false, staff: false })),
}));
vi.mock("@/lib/payroll-access/permissions", () => ({
	hasActivePayrollAccessGrant: vi.fn(async () => mockState.hasGrant),
}));
vi.mock("@/lib/personnel-file/access", () => ({
	managesAnyDocuments: () => false,
}));
vi.mock("@/lib/personnel-file/access-store", () => ({
	resolvePersonnelFileAccessForIdentity: vi.fn(async () => null),
}));
vi.mock("@/lib/projects/project-manager-settings-access", () => ({
	managesProjectBelowManagerTierForIdentity: vi.fn(async () => false),
}));
vi.mock("@/lib/time-tracking/period-submissions/settings", () => ({
	loadCollectsPeriodSubmissions: vi.fn(async () => false),
}));
vi.mock("@/lib/time-tracking/vehicle-use/driving-details-team-store", () => ({
	drivingDetailsTeamScope: () => null,
}));
vi.mock("@/lib/time-tracking/who-is-in/queries", () => ({
	hasWhoIsInLocations: vi.fn(async () => false),
}));
vi.mock("@/lib/travel-expenses/finance-access", () => ({
	loadFinanceActorForIdentity: vi.fn(async () => null),
}));
vi.mock("@/lib/works-council/permissions", () => ({
	canViewWorksCouncilPortal: () => false,
}));
vi.mock("./app-sidebar", () => ({
	AppSidebar: (props: Record<string, unknown>) => {
		mockState.appSidebarSpy(props);
		return <div data-testid="app-sidebar" />;
	},
}));

const { ServerAppSidebar } = await import("./server-app-sidebar");

async function renderSidebar() {
	const element = await ServerAppSidebar({
		user: { name: "User", email: "user@example.com" },
	});
	render(element);
	return mockState.appSidebarSpy.mock.calls.at(-1)?.[0] as {
		navigationCapabilities: { payroll: boolean; approvalInbox?: boolean };
	};
}

function memberAbility(
	employee: NonNullable<typeof mockState.employee>,
	customRoles: PrincipalContext["customRoles"] = [],
): AppAbility {
	return defineAbilityFor({
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: employee.organizationId,
		orgMembership: {
			organizationId: employee.organizationId,
			role: employee.role === "admin" ? "admin" : "member",
			status: "approved",
		},
		employee: { ...employee, teamId: null },
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles,
	});
}

describe("ServerAppSidebar Approval inbox visibility (#1976)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.settingsAccess = "member";
		mockState.employee = null;
		mockState.ability = null;
	});

	it("lists the inbox for a custom-role approver without a manager role", async () => {
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };
		mockState.ability = memberAbility(mockState.employee, [
			{
				roleId: "role-1",
				roleName: "Approver",
				baseTier: "employee",
				permissions: [{ action: "approve", subject: "Approval" }],
			},
		]);

		const props = await renderSidebar();
		expect(props.navigationCapabilities.approvalInbox).toBe(true);
	});

	it("lists the inbox for a manager", async () => {
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "manager" };
		mockState.ability = memberAbility(mockState.employee);

		const props = await renderSidebar();
		expect(props.navigationCapabilities.approvalInbox).toBe(true);
	});

	it("hides the inbox from an employee without approval permissions", async () => {
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };
		mockState.ability = memberAbility(mockState.employee);

		const props = await renderSidebar();
		expect(props.navigationCapabilities.approvalInbox).toBe(false);
	});

	it("hides the inbox from a manager whose ability carries no employee principal", async () => {
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "manager" };
		mockState.ability = createEmptyAbility();

		const props = await renderSidebar();
		expect(props.navigationCapabilities.approvalInbox).toBe(false);
	});

	it("hides the inbox without an employee in the active organization", async () => {
		mockState.settingsAccess = "orgAdmin";

		const props = await renderSidebar();
		expect(props.navigationCapabilities.approvalInbox).toBe(false);
	});
});

describe("ServerAppSidebar payroll navigation visibility (#1957)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.settingsAccess = "member";
		mockState.employee = null;
		mockState.hasGrant = false;
		mockState.canClose = false;
		mockState.canReopen = false;
		mockState.ability = null;
	});

	it("shows Payroll for an org admin without an employee record or payroll grant", async () => {
		mockState.settingsAccess = "orgAdmin";
		mockState.employee = null;
		mockState.hasGrant = false;

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(true);
	});

	it("shows Payroll for a delegated payroll officer with an active grant", async () => {
		mockState.settingsAccess = "member";
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };
		mockState.hasGrant = true;

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(true);
	});

	it("shows Payroll for a close-month-only custom-role holder without org-admin status or grant", async () => {
		mockState.settingsAccess = "member";
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };
		mockState.hasGrant = false;
		mockState.canClose = true;

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(true);
	});

	it("shows Payroll for a reopen-month-only custom-role holder without org-admin status or grant", async () => {
		mockState.settingsAccess = "member";
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };
		mockState.hasGrant = false;
		mockState.canReopen = true;

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(true);
	});

	it("hides Payroll for a member without org-admin status, payroll grant, or month-closure permissions", async () => {
		mockState.settingsAccess = "member";
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(false);
	});
});
