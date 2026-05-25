import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentSettingsRouteContext: vi.fn(),
	requireUser: vi.fn(),
	findOrganization: vi.fn(),
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
	});

	it("passes the Works Council settings entry to the grid when the org feature is enabled", async () => {
		const page = await SettingsPage();
		const grid = page.props.children.props.children;

		expect(grid.props.visibleSettings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ href: "/settings/compliance/works-council" }),
			]),
		);
	});
});
