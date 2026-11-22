/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	settingsAccessTier: "member" as "member" | "manager" | "orgAdmin",
	employee: null as { id: string; organizationId: string; role: "admin" | "manager" | "employee" } | null,
	hasGrant: false,
	canClose: false,
	canReopen: false,
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
	getRenderSettingsAccessTier: vi.fn(async () => mockState.settingsAccessTier),
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
	getRenderAbility: vi.fn(async () => ({
		can: (action: string, subject: string) => {
			if (subject !== "PayrollPeriod") return false;
			if (action === "close") return mockState.canClose;
			if (action === "reopen") return mockState.canReopen;
			return false;
		},
	})),
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
		navigationCapabilities: { payroll: boolean };
	};
}

describe("ServerAppSidebar payroll navigation visibility (#1957)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.settingsAccessTier = "member";
		mockState.employee = null;
		mockState.hasGrant = false;
		mockState.canClose = false;
		mockState.canReopen = false;
	});

	it("shows Payroll for an org admin without an employee record or payroll grant", async () => {
		mockState.settingsAccessTier = "orgAdmin";
		mockState.employee = null;
		mockState.hasGrant = false;

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(true);
	});

	it("shows Payroll for a delegated payroll officer with an active grant", async () => {
		mockState.settingsAccessTier = "member";
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };
		mockState.hasGrant = true;

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(true);
	});

	it("shows Payroll for a close-month-only custom-role holder without org-admin status or grant", async () => {
		mockState.settingsAccessTier = "member";
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };
		mockState.hasGrant = false;
		mockState.canClose = true;

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(true);
	});

	it("shows Payroll for a reopen-month-only custom-role holder without org-admin status or grant", async () => {
		mockState.settingsAccessTier = "member";
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };
		mockState.hasGrant = false;
		mockState.canReopen = true;

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(true);
	});

	it("hides Payroll for a member without org-admin status, payroll grant, or month-closure permissions", async () => {
		mockState.settingsAccessTier = "member";
		mockState.employee = { id: "emp-1", organizationId: "org-1", role: "employee" };

		const props = await renderSidebar();
		expect(props.navigationCapabilities.payroll).toBe(false);
	});
});
