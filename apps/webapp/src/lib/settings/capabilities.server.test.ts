import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineAbilityFor } from "@/lib/authorization/ability";
import type { AuthorizedOrganizationIdentity } from "@/lib/auth/organization-identity";
import type { PrincipalContext } from "@/lib/authorization/types";
import { HIDDEN_DRIVING_LICENCE_VISIBILITY } from "@/lib/organization/driving-licence/visibility-rules";
import { DEFAULT_SETTINGS_CAPABILITIES } from "./capabilities";

const mocks = vi.hoisted(() => ({
	loadOrganizationPrincipalForIdentity: vi.fn(),
	hasTaskManagedProject: vi.fn(),
	readDrivingLicenceVisibilityForIdentity: vi.fn(),
	hasActiveOrganizationShareLinks: vi.fn(),
	getRenderSettingsAccess: vi.fn(),
	getRenderOrganizationIdentity: vi.fn(),
	getRenderOrganizationAbility: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/authorization/principal-loader", () => ({
	loadOrganizationPrincipalForIdentity: mocks.loadOrganizationPrincipalForIdentity,
}));
vi.mock("@/lib/projects/project-task-permission", () => ({
	hasTaskManagedProject: mocks.hasTaskManagedProject,
}));
vi.mock("@/lib/organization/driving-licence/visibility", () => ({
	readDrivingLicenceVisibilityForIdentity: mocks.readDrivingLicenceVisibilityForIdentity,
	showsDrivingLicenceSettings: (visibility: { settings: string }) =>
		visibility.settings !== "hidden",
}));
vi.mock("@/lib/projects/report-share/report-share-links", () => ({
	hasActiveOrganizationShareLinks: mocks.hasActiveOrganizationShareLinks,
}));
vi.mock("@/lib/auth/render-context", () => ({
	getRenderSettingsAccess: mocks.getRenderSettingsAccess,
	getRenderOrganizationIdentity: mocks.getRenderOrganizationIdentity,
	getRenderOrganizationAbility: mocks.getRenderOrganizationAbility,
}));

const { resolveSettingsCapabilitiesForIdentity, getRenderSettingsCapabilities } =
	await import("./capabilities.server");

function buildPrincipal(overrides: Partial<PrincipalContext> = {}): PrincipalContext {
	return {
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: { organizationId: "org-1", role: "member", status: "active" },
		employee: {
			id: "emp-1",
			organizationId: "org-1",
			role: "employee",
			teamId: null,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
		...overrides,
	};
}

const memberIdentity: AuthorizedOrganizationIdentity = {
	userId: "user-1",
	organizationId: "org-1",
	membershipRole: "member",
	employee: {
		id: "emp-1",
		organizationId: "org-1",
		role: "employee",
		teamId: null,
	},
};

const orgAdminIdentity: AuthorizedOrganizationIdentity = {
	userId: "user-admin",
	organizationId: "org-1",
	membershipRole: "admin",
	employee: {
		id: "emp-admin",
		organizationId: "org-1",
		role: "employee",
		teamId: null,
	},
};

const ownerWithoutEmployeeIdentity: AuthorizedOrganizationIdentity = {
	userId: "user-owner",
	organizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};

describe("resolveSettingsCapabilitiesForIdentity", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadOrganizationPrincipalForIdentity.mockResolvedValue(buildPrincipal());
		mocks.hasTaskManagedProject.mockResolvedValue(false);
		mocks.readDrivingLicenceVisibilityForIdentity.mockResolvedValue(
			HIDDEN_DRIVING_LICENCE_VISIBILITY,
		);
		mocks.hasActiveOrganizationShareLinks.mockResolvedValue(false);
	});

	it("returns all-false capabilities without querying when settingsAccess is null", async () => {
		const capabilities = await resolveSettingsCapabilitiesForIdentity({
			settingsAccess: null,
			identity: memberIdentity,
		});

		expect(capabilities).toEqual(DEFAULT_SETTINGS_CAPABILITIES);
		expect(mocks.loadOrganizationPrincipalForIdentity).not.toHaveBeenCalled();
		expect(mocks.hasTaskManagedProject).not.toHaveBeenCalled();
		expect(mocks.readDrivingLicenceVisibilityForIdentity).not.toHaveBeenCalled();
		expect(mocks.hasActiveOrganizationShareLinks).not.toHaveBeenCalled();
	});

	it("exposes canAccessClosedMonths when a member's custom role grants close or reopen on PayrollPeriod", async () => {
		for (const action of ["close", "reopen"] as const) {
			mocks.loadOrganizationPrincipalForIdentity.mockResolvedValueOnce(
				buildPrincipal({
					customRoles: [
						{
							roleId: "role-1",
							roleName: "Month Closer",
							baseTier: "employee",
							permissions: [{ action, subject: "PayrollPeriod" }],
						},
					],
				}),
			);

			const capabilities = await resolveSettingsCapabilitiesForIdentity({
				settingsAccess: "member",
				identity: memberIdentity,
			});

			expect(capabilities).toEqual({
				...DEFAULT_SETTINGS_CAPABILITIES,
				canAccessClosedMonths: true,
			});
		}
	});

	it("exposes canManageApprovalEscalation when a custom role grants manage Approval", async () => {
		mocks.loadOrganizationPrincipalForIdentity.mockResolvedValueOnce(
			buildPrincipal({
				customRoles: [
					{
						roleId: "role-2",
						roleName: "Approval Escalation Lead",
						baseTier: "employee",
						permissions: [{ action: "manage", subject: "Approval" }],
					},
				],
			}),
		);

		const capabilities = await resolveSettingsCapabilitiesForIdentity({
			settingsAccess: "member",
			identity: memberIdentity,
		});

		expect(capabilities).toEqual({
			...DEFAULT_SETTINGS_CAPABILITIES,
			canManageApprovalEscalation: true,
		});
	});

	it("exposes canManageProjects for a member who manages a project, skipping lookup when projectsEnabled is false", async () => {
		mocks.hasTaskManagedProject.mockResolvedValue(true);

		const enabledResult = await resolveSettingsCapabilitiesForIdentity({
			settingsAccess: "member",
			identity: memberIdentity,
			projectsEnabled: true,
		});
		expect(enabledResult.canManageProjects).toBe(true);
		expect(mocks.hasTaskManagedProject).toHaveBeenCalledTimes(1);

		mocks.hasTaskManagedProject.mockClear();
		const disabledResult = await resolveSettingsCapabilitiesForIdentity({
			settingsAccess: "member",
			identity: memberIdentity,
			projectsEnabled: false,
		});
		expect(disabledResult.canManageProjects).toBe(false);
		expect(mocks.hasTaskManagedProject).not.toHaveBeenCalled();
	});

	it("skips org-admin-only queries for members and scoped managers", async () => {
		const scopedManagerIdentity: AuthorizedOrganizationIdentity = {
			...memberIdentity,
			employee: { ...memberIdentity.employee!, role: "manager" },
		};
		const capabilities = await resolveSettingsCapabilitiesForIdentity({
			settingsAccess: "scopedManager",
			identity: scopedManagerIdentity,
		});

		expect(capabilities).toEqual(DEFAULT_SETTINGS_CAPABILITIES);
		expect(mocks.hasTaskManagedProject).not.toHaveBeenCalled();
		expect(mocks.readDrivingLicenceVisibilityForIdentity).not.toHaveBeenCalled();
		expect(mocks.hasActiveOrganizationShareLinks).not.toHaveBeenCalled();
	});

	it("resolves driving licence, active share links, and closed months for orgAdmin and owner", async () => {
		mocks.readDrivingLicenceVisibilityForIdentity.mockResolvedValue({
			...HIDDEN_DRIVING_LICENCE_VISIBILITY,
			featureEnabled: true,
			settings: "full",
		});
		mocks.hasActiveOrganizationShareLinks.mockResolvedValue(true);

		const adminCaps = await resolveSettingsCapabilitiesForIdentity({
			settingsAccess: "orgAdmin",
			identity: orgAdminIdentity,
		});
		expect(adminCaps).toEqual({
			canAccessClosedMonths: true,
			canManageApprovalEscalation: false,
			canManageProjects: false,
			canManageDrivingLicence: true,
			hasActiveReportShareLinks: true,
		});

		mocks.loadOrganizationPrincipalForIdentity.mockClear();
		const ownerCaps = await resolveSettingsCapabilitiesForIdentity({
			settingsAccess: "owner",
			identity: ownerWithoutEmployeeIdentity,
		});
		expect(ownerCaps).toEqual({
			canAccessClosedMonths: true,
			canManageApprovalEscalation: false,
			canManageProjects: false,
			canManageDrivingLicence: true,
			hasActiveReportShareLinks: true,
		});
		// Owner without an employee record skips principal-loader query.
		expect(mocks.loadOrganizationPrincipalForIdentity).not.toHaveBeenCalled();
	});

	it("reuses pre-loaded ability and drivingLicenceVisibility when provided", async () => {
		const preloadedAbility = defineAbilityFor(
			buildPrincipal({
				customRoles: [
					{
						roleId: "role-3",
						roleName: "Escalation",
						baseTier: "employee",
						permissions: [
							{ action: "close", subject: "PayrollPeriod" },
							{ action: "manage", subject: "Approval" },
						],
					},
				],
			}),
		);

		const capabilities = await resolveSettingsCapabilitiesForIdentity({
			settingsAccess: "orgAdmin",
			identity: orgAdminIdentity,
			ability: preloadedAbility,
			drivingLicenceVisibility: {
				...HIDDEN_DRIVING_LICENCE_VISIBILITY,
				settings: "retention_only",
			},
		});

		expect(capabilities).toEqual({
			canAccessClosedMonths: true,
			canManageApprovalEscalation: true,
			canManageProjects: false,
			canManageDrivingLicence: true,
			hasActiveReportShareLinks: false,
		});
		expect(mocks.loadOrganizationPrincipalForIdentity).not.toHaveBeenCalled();
		expect(mocks.readDrivingLicenceVisibilityForIdentity).not.toHaveBeenCalled();
	});

	it("reads render context access, identity, and org ability in getRenderSettingsCapabilities", async () => {
		mocks.getRenderSettingsAccess.mockResolvedValue("member");
		mocks.getRenderOrganizationIdentity.mockResolvedValue(memberIdentity);
		mocks.getRenderOrganizationAbility.mockResolvedValue(
			defineAbilityFor(
				buildPrincipal({
					customRoles: [
						{
							roleId: "role-4",
							roleName: "Month Closer",
							baseTier: "employee",
							permissions: [{ action: "close", subject: "PayrollPeriod" }],
						},
					],
				}),
			),
		);

		const capabilities = await getRenderSettingsCapabilities();
		expect(capabilities.canAccessClosedMonths).toBe(true);
		expect(capabilities.canManageApprovalEscalation).toBe(false);
	});
});
