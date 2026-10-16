import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";

const mockState = vi.hoisted(() => ({
	getCurrentSettingsRouteContext: vi.fn(),
	requireUser: vi.fn(),
	findOrganization: vi.fn(),
	managesProjectBelowManagerTier: vi.fn(),
}));

vi.mock("@/lib/projects/project-manager-settings-access", () => ({
	managesProjectBelowManagerTier: mockState.managesProjectBelowManagerTier,
}));

vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: mockState.getCurrentSettingsRouteContext,
	requireUser: mockState.requireUser,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: mockState.findOrganization,
			},
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	organization: {
		id: "organization.id",
	},
}));

vi.mock("@/components/settings/settings-grid", () => ({
	SettingsGrid: "SettingsGrid",
}));

const { default: SettingsPage } = await import("./page");

describe("SettingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentSettingsRouteContext.mockResolvedValue({
			authContext: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
				employee: null,
			},
			accessTier: "orgAdmin",
		});
		mockState.findOrganization.mockResolvedValue({
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
			demoDataEnabled: true,
			worksCouncilEnabled: true,
		});
		mockState.managesProjectBelowManagerTier.mockResolvedValue(false);
	});

	it("returns a navigation fallback before accessing the request session", () => {
		const page = SettingsPage();

		expect(page).not.toBeInstanceOf(Promise);
		expect(mockState.getCurrentSettingsRouteContext).not.toHaveBeenCalled();
		expect(mockState.findOrganization).not.toHaveBeenCalled();
		expect(page.type).toBe(Suspense);
		expect(page.props.fallback.type).toBe(SettingsContentLoading);
	});

	it("lists Projects for a member-tier user who manages a project of the active organization (#928)", async () => {
		mockState.getCurrentSettingsRouteContext.mockResolvedValue({
			authContext: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
				employee: null,
			},
			accessTier: "member",
		});
		const settingHrefs = async () => {
			const page = await SettingsPage().props.children.type();
			const grid = page.props.children.props.children;
			return grid.props.visibleSettings.map(
				(entry: { href: string }) => entry.href,
			);
		};

		expect(await settingHrefs()).not.toContain("/settings/projects");

		mockState.managesProjectBelowManagerTier.mockResolvedValue(true);

		expect(await settingHrefs()).toContain("/settings/projects");
		expect(mockState.managesProjectBelowManagerTier).toHaveBeenCalledWith(
			"member",
			"user-1",
			"org-1",
		);
	});

	it("passes the Works Council settings entry to the grid when the org feature is enabled", async () => {
		const page = await SettingsPage().props.children.type();
		const grid = page.props.children.props.children;

		expect(grid.props.visibleSettings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ href: "/settings/compliance/works-council" }),
			]),
		);
	});
});
