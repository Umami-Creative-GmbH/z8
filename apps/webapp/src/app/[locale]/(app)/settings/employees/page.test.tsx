import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentSettingsAccess: vi.fn(),
	getCurrentSettingsRouteContext: vi.fn(),
	redirect: vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	}),
}));

vi.mock("next/navigation", () => ({ redirect: mockState.redirect }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: mockState.getCurrentSettingsAccess,
	getCurrentSettingsRouteContext: mockState.getCurrentSettingsRouteContext,
}));
vi.mock("./employees-page-client", () => ({
	EmployeesPageClient: "EmployeesPageClient",
}));

const { default: EmployeesPage } = await import("./page");

describe("EmployeesPage viewer settings access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentSettingsRouteContext.mockResolvedValue({
			authContext: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			accessTier: "manager",
		});
	});

	it("passes the viewer's settings access to directory controls", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			organizationId: "org-1",
			settingsAccess: "scopedManager",
		});

		const page = await EmployeesPage();

		expect(mockState.getCurrentSettingsAccess).toHaveBeenCalledTimes(1);
		expect(page.props).toMatchObject({
			currentUserId: "user-1",
			settingsAccess: "scopedManager",
			people: undefined,
		});
	});

	it("denies directory access when the viewer has no settings access", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			organizationId: "org-1",
			settingsAccess: null,
		});

		await expect(EmployeesPage()).rejects.toThrow("redirect:/en/settings");
	});

	it("denies directory access when settings access belongs to another organization", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			organizationId: "org-2",
			settingsAccess: "owner",
		});

		await expect(EmployeesPage()).rejects.toThrow("redirect:/en/settings");
	});
});
