import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { DEFAULT_SETTINGS_CAPABILITIES } from "@/lib/settings/capabilities";

const mockState = vi.hoisted(() => ({
	getRenderAuthContext: vi.fn(),
	getRenderSettingsAccess: vi.fn(),
	getRenderSettingsCapabilities: vi.fn(),
	getRenderOrganizationSettings: vi.fn(),
	requireUser: vi.fn(),
}));

vi.mock("@/lib/auth/render-context", () => ({
	getRenderAuthContext: mockState.getRenderAuthContext,
	getRenderSettingsAccess: mockState.getRenderSettingsAccess,
	getRenderOrganizationSettings: mockState.getRenderOrganizationSettings,
}));

vi.mock("@/lib/settings/capabilities.server", () => ({
	getRenderSettingsCapabilities: mockState.getRenderSettingsCapabilities,
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireUser: mockState.requireUser,
}));

vi.mock("@/components/settings/settings-grid", () => ({
	SettingsGrid: "SettingsGrid",
}));

const { default: SettingsPage } = await import("./page");

describe("SettingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getRenderAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
			employee: null,
		});
		mockState.getRenderSettingsAccess.mockResolvedValue("orgAdmin");
		mockState.getRenderSettingsCapabilities.mockResolvedValue({
			...DEFAULT_SETTINGS_CAPABILITIES,
		});
		mockState.getRenderOrganizationSettings.mockResolvedValue({
			organizationId: "org-1",
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
			demoDataEnabled: true,
			worksCouncilEnabled: true,
			billableTimeEnabled: false,
			personnelFilesEnabled: false,
			equipmentEnabled: false,
			timezone: "UTC",
			deletedAt: null,
		});
	});

	async function renderGridProps() {
		const page = await SettingsPage().props.children.type();
		return page.props.children.props.children.props;
	}

	async function settingHrefs() {
		const props = await renderGridProps();
		return props.visibleSettings.map((entry: { href: string }) => entry.href);
	}

	it("returns a navigation fallback before accessing the request session", () => {
		const page = SettingsPage();

		expect(page).not.toBeInstanceOf(Promise);
		expect(mockState.getRenderAuthContext).not.toHaveBeenCalled();
		expect(mockState.getRenderSettingsAccess).not.toHaveBeenCalled();
		expect(mockState.getRenderSettingsCapabilities).not.toHaveBeenCalled();
		expect(page.type).toBe(Suspense);
		expect(page.props.fallback.type).toBe(SettingsContentLoading);
	});

	it("lists Driving licence control only when canManageDrivingLicence is true", async () => {
		expect(await settingHrefs()).not.toContain("/settings/driving-licence");
		expect(await settingHrefs()).not.toContain("/driving-licence");

		mockState.getRenderSettingsCapabilities.mockResolvedValue({
			...DEFAULT_SETTINGS_CAPABILITIES,
			canManageDrivingLicence: true,
		});

		expect(await settingHrefs()).toContain("/settings/driving-licence");
	});

	it("lists Projects for a member who manages a project of the active organization", async () => {
		mockState.getRenderSettingsAccess.mockResolvedValue("member");

		expect(await settingHrefs()).not.toContain("/settings/projects");

		mockState.getRenderSettingsCapabilities.mockResolvedValue({
			...DEFAULT_SETTINGS_CAPABILITIES,
			canManageProjects: true,
		});

		expect(await settingHrefs()).toContain("/settings/projects");
	});

	it("lists Closed months and Approval for a member granted custom-role capabilities", async () => {
		mockState.getRenderSettingsAccess.mockResolvedValue("member");
		mockState.getRenderSettingsCapabilities.mockResolvedValue({
			...DEFAULT_SETTINGS_CAPABILITIES,
			canAccessClosedMonths: true,
			canManageApprovalEscalation: true,
		});

		const hrefs = await settingHrefs();
		expect(hrefs).toContain("/settings/closed-months");
		expect(hrefs).toContain("/settings/approval-policies");
		expect(hrefs).not.toContain("/settings/organization");
	});

	it("shows only account-only settings when settingsAccess is null (former employee or pending/missing membership)", async () => {
		mockState.getRenderSettingsAccess.mockResolvedValue(null);
		mockState.getRenderOrganizationSettings.mockResolvedValue(null);

		const props = await renderGridProps();
		expect(props.visibleSettings.map((entry: { id: string }) => entry.id)).toEqual([
			"profile",
			"security",
			"notifications",
			"wellness",
		]);
		expect(props.canChangeFeatures).toBe(false);
	});

	it("passes the Works Council settings entry to the grid when the org feature is enabled", async () => {
		const props = await renderGridProps();

		expect(props.visibleSettings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ href: "/settings/compliance/works-council" }),
			]),
		);
		expect(props.canChangeFeatures).toBe(true);
	});

	it("keeps Report Share Links visible when Projects is off and active share links exist", async () => {
		mockState.getRenderOrganizationSettings.mockResolvedValue({
			organizationId: "org-1",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: false,
			worksCouncilEnabled: false,
			billableTimeEnabled: false,
			personnelFilesEnabled: false,
			equipmentEnabled: false,
			timezone: "UTC",
			deletedAt: null,
		});
		mockState.getRenderSettingsCapabilities.mockResolvedValue({
			...DEFAULT_SETTINGS_CAPABILITIES,
			hasActiveReportShareLinks: true,
		});

		expect(await settingHrefs()).toContain("/settings/report-share-links");
	});
});
